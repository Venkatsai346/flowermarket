# Admin Frontend (Web) — Remaining Feature Plan

**Scope**: `frontend/apps/web` (the React/Vite admin console) plus the shared client in `packages/shared/src/api`.
**Date**: 2026-09-03
**Basis**: 1:1 mapping to the existing `backend/src/routes/*`. This plan adds **no new domain rules**; every phase consumes a live backend route or calls out an explicit backend gap that must be closed before the page can be fully interactive.

> Standing constraint: new UI must reuse `components/ui/*` (`Card`, `Table`, `Badge`, `Button`, `Modal`, `Pagination`, `EmptyState`, `Field`, `PageHeader`, `Stat`, `Spinner`, `Toaster`), `components/charts/TrendChart`, `components/media/*`, `lib/useApi.js`, `lib/toasts.js`, `lib/utils.js`, the shared `@flower-market/shared` meta maps, the `features/**` directory pattern, and the Sidebar group pattern. Every network call goes through `api.*` in `packages/shared/src/api/endpoints.js` — no raw `fetch` in page components.

---

## 0. Executive summary

The backend is ahead of the web console. The remaining work is one feature directory at a time, grouped by business capability:

| # | Phase | Audience | Existing backend routes | Suggested order |
|---|-------|----------|------------------------|-----------------|
| 0 | API parity + download primitive | web/shared | all | Do first |
| 1 | Fulfillment ops centre | store admin | `/fulfillment`, `/admin/hubs`, `/admin/slots` | 1 |
| 2 | Returns, QC & manual refunds | store admin/ops | `/returns`, `/fulfillment/refunds` | 2 |
| 3 | Rider delivery workspace | rider/admin/super_admin | `/rider` | 3 |
| 4 | Policies & coupon admin | store admin | `/policies` | 4 |
| 5 | Search admin | store admin | `/search` | 5 |
| 6 | GST / tax admin | store admin + super_admin | `/tax` | 6 |
| 7 | Customer, staff & rider directory | store admin | `/admin/users`, `/admin/users/riders/stats` | 7 |
| 8 | Inventory & hub depth | store admin | `/admin/inventory/*`, `/admin/hubs/*` | 8 |
| 9 | Catalog admin depth | store admin + super_admin | `/catalog/admin/*`, `/catalog/tenant/*` | 9 |
| 10 | Platform lifecycle, KYC & ops automation | super_admin | `/payouts/admin`, `/marketplace/admin`, `/admin/notifications`, `/admin/exports` | 10 |
| 11 | Cross-cutting polish | all | n/a | 11 |

Sequencing rationale:

- **Phase 0 first** because several missing endpoints are the only reason the remaining pages cannot be written cleanly.
- **Fulfilment before returns** because returns are an order/ops continuation and both reuse the same order-state, slot and user context.
- **Rider workspace before customer directory** so rider-only actors (`rider`) stop landing on `/no-access`; this is a small, high-leverage UX fix.
- **Policies before catalog depth** because delivery-fee, tax and refund policies directly affect the catalogue/checkout admin forms.
- **Platform KYC/lifecycle last** because it is the riskiest surface (money, tenant state, provider calls) and benefits from a stable tenant/vendor/user base built in earlier phases.

---

## Phase 0 — Shared client parity and download primitive

**Goal**: make every remaining page expressible with a typed `api.*` helper, and support the CSV endpoints without leaking raw `fetch` into components.

### 0.1 Extend `packages/shared/src/api/endpoints.js`

Add the missing helpers (all map to existing backend routes):

- `admin.exportProducts = (q) => c.get('/admin/products/export.csv', { query: q, raw: true })`
- `admin.inventory = (q) => c.get('/admin/inventory', { query: q })`
- `admin.inventoryLedger = (id) => c.get(\`/admin/inventory/ledger/${id}\`)`
- `admin.exportInventory = (q) => c.get('/admin/inventory/export.csv', { query: q, raw: true })`
- `admin.createHub = (body) => c.post('/admin/hubs', body)`
- `admin.updateHub = (id, body) => c.patch(\`/admin/hubs/${id}\`, body)`
- `admin.toggleHub = (id, body) => c.post(\`/admin/hubs/${id}/toggle\`, body)`
- `admin.manageHubPincodes = (id, body) => c.post(\`/admin/hubs/${id}/pincodes\`, body)`
- `admin.slots = (q) => c.get('/admin/slots', { query: q })`
- `admin.overrideSlot = (id, body) => c.post(\`/admin/slots/${id}/override\`, body)`
- `admin.setSlotStatus = (id, body) => c.post(\`/admin/slots/${id}/status\`, body)`
- `admin.slotsUtilization = (q) => c.get('/admin/slots/utilization', { query: q })`
- `admin.exportOrders = (q) => c.get('/admin/orders/export.csv', { query: q, raw: true })`
- `admin.users = (q) => c.get('/admin/users', { query: q })`
- `admin.user = (id) => c.get(\`/admin/users/${id}\`)`
- `admin.exportUsers = (q) => c.get('/admin/users/export.csv', { query: q, raw: true })`
- `admin.createStaff = (body) => c.post('/admin/users/staff', body)`
- `admin.setUserStatus = (id, body) => c.patch(\`/admin/users/${id}/status\`, body)`
- `admin.setUserRole = (id, body) => c.patch(\`/admin/users/${id}/role\`, body)`
- `admin.riderStats = (q) => c.get('/admin/users/riders/stats', { query: q })`
- `admin.categoryPerformance = (q) => c.get('/admin/analytics/categories', { query: q })`
- `admin.hubPerformance = (q) => c.get('/admin/analytics/hubs', { query: q })`
- `admin.slotPerformance = (q) => c.get('/admin/analytics/slots', { query: q })`
- `admin.exportAnalytics = (q) => c.get('/admin/analytics/export.csv', { query: q, raw: true })`
- `admin.notificationTemplates = (q) => c.get('/admin/notifications/templates', { query: q })`
- `admin.createNotificationTemplate = (body) => c.post('/admin/notifications/templates', body)`
- `admin.updateNotificationTemplate = (id, body) => c.patch(\`/admin/notifications/templates/${id}\`, body)`
- `admin.deleteNotificationTemplate = (id) => c.del(\`/admin/notifications/templates/${id}\`)`
- `admin.notifications = (q) => c.get('/admin/notifications', { query: q })`
- `admin.sendNotification = (body) => c.post('/admin/notifications/send', body)`
- `admin.processNotifications = (body) => c.post('/admin/notifications/process', body)`
- `admin.exports = (q) => c.get('/admin/exports', { query: q })`
- `admin.createExport = (body) => c.post('/admin/exports', body)`
- `admin.exportDetail = (id) => c.get(\`/admin/exports/${id}\`)`
- `admin.runExport = (id) => c.post(\`/admin/exports/${id}/run\`)`
- `admin.downloadExport = (id) => c.get(\`/admin/exports/${id}/download\`, { raw: true })`
- `admin.runDueExports = (body) => c.post('/admin/exports/run', body)`

- `fulfillment.listAll = (q) => c.get('/fulfillment/orders', { query: q })`
- `fulfillment.startPicking = (id) => c.post(\`/fulfillment/orders/${id}/pick\`)`
- `fulfillment.pack = (id) => c.post(\`/fulfillment/orders/${id}/pack\`)`
- `fulfillment.dispatch = (id, body) => c.post(\`/fulfillment/orders/${id}/dispatch\`, body)`
- `fulfillment.deliver = (id, body) => c.post(\`/fulfillment/orders/${id}/deliver\`, body)`
- `fulfillment.deliveryFailed = (id, body) => c.post(\`/fulfillment/orders/${id}/delivery-failed\`, body)`
- `fulfillment.retryDelivery = (id, body) => c.post(\`/fulfillment/orders/${id}/retry-delivery\`, body)`
- `fulfillment.generateSlots = (body) => c.post('/fulfillment/slots/generate', body)`
- `fulfillment.slotUtilization = (q) => c.get('/fulfillment/slots/utilization', { query: q })`
- `fulfillment.sweepExpiredHolds = (q) => c.post('/fulfillment/slots/sweep', q)`
- `fulfillment.forecastHub = (body) => c.post('/fulfillment/forecast', body)`
- `fulfillment.forecastUpcoming = (q) => c.get('/fulfillment/forecast/upcoming', { query: q })`
- `fulfillment.forecastHistory = (q) => c.get('/fulfillment/forecast/history', { query: q })`
- `fulfillment.sweepExpiredAssignments = (q) => c.post('/fulfillment/assignments/sweep', q)`
- `fulfillment.reconcilePayments = (q) => c.post('/fulfillment/reconcile/payments', q)`
- `fulfillment.payments = (q) => c.get('/fulfillment/payments', { query: q })`
- `fulfillment.payment = (id) => c.get(\`/fulfillment/payments/${id}\`)`
- `fulfillment.returns = (q) => c.get('/fulfillment/returns', { query: q })`
- `fulfillment.refunds = (q) => c.get('/fulfillment/refunds', { query: q })`
- `fulfillment.adminRefund = (body) => c.post('/fulfillment/refunds', body)`

- `returns.returnDetail = (id, q = {}) => c.get(\`/returns/${id}\`, { query: q })` (admin already uses `/fulfillment/returns` for the list)
- `returns.markPickedUp = (id) => c.post(\`/returns/${id}/pickup\`)`
- `returns.qcDecision = (id, body) => c.post(\`/returns/${id}/qc\`, body)`

- `rider.deliveries = (q) => c.get('/rider/deliveries', { query: q })`
- `rider.availability = (body) => c.post('/rider/availability', body)`
- `rider.accept = (id) => c.post(\`/rider/deliveries/${id}/accept\`)`
- `rider.reject = (id, body) => c.post(\`/rider/deliveries/${id}/reject\`, body)`
- `rider.arriveHub = (id) => c.post(\`/rider/deliveries/${id}/arrive-hub\`)`
- `rider.depart = (id, body) => c.post(\`/rider/deliveries/${id}/depart\`, body)`
- `rider.arrive = (id) => c.post(\`/rider/deliveries/${id}/arrive\`)`
- `rider.complete = (id, body) => c.post(\`/rider/deliveries/${id}/complete\`, body)`
- `rider.fail = (id, body) => c.post(\`/rider/deliveries/${id}/fail\`, body)`

- `policies.deliveryFees = () => c.get('/policies/delivery-fee')`
- `policies.createDeliveryFee = (body) => c.post('/policies/delivery-fee', body)`
- `policies.updateDeliveryFee = (id, body) => c.patch(\`/policies/delivery-fee/${id}\`, body)`
- `policies.taxPolicies = (q) => c.get('/policies/tax', { query: q })`
- `policies.upsertTaxPolicy = (body) => c.post('/policies/tax', body)`
- `policies.coupons = () => c.get('/policies/coupons')`
- `policies.createCoupon = (body) => c.post('/policies/coupons', body)`
- `policies.refund = () => c.get('/policies/refund')`
- `policies.updateRefund = (body) => c.patch('/policies/refund', body)`
- `policies.previewCoupon = (q) => c.get('/policies/coupons/preview', { query: q })`

- `catalogAdmin.changeRequests = (q) => c.get('/catalog/admin/change-requests', { query: q })`
- `catalogAdmin.reviewChangeRequest = (id, body) => c.post(\`/catalog/admin/change-requests/${id}/review\`, body)`
- `catalogAdmin.audit = (q) => c.get('/catalog/admin/audit', { query: q })`
- `catalogAdmin.drainEvents = () => c.post('/catalog/admin/events/drain')`
- `catalogAdmin.eventStatus = () => c.get('/catalog/admin/events/status')`
- `catalogTenant.listings = (q) => c.get('/catalog/tenant/listings', { query: q })`
- `catalogTenant.listing = (id) => c.get(\`/catalog/tenant/listings/${id}\`)`
- `catalogTenant.createListing = (body) => c.post('/catalog/tenant/listings', body)`
- `catalogTenant.updatePrice = (id, body) => c.patch(\`/catalog/tenant/listings/${id}/price\`, body)`
- `catalogTenant.updateStatus = (id, body) => c.patch(\`/catalog/tenant/listings/${id}/status\`, body)`
- `catalogTenant.deactivateListing = (id) => c.post(\`/catalog/tenant/listings/${id}/deactivate\`)`
- `catalogTenant.stock = (id) => c.get(\`/catalog/tenant/listings/${id}/stock\`)`
- `catalogTenant.setStock = (id, body) => c.put(\`/catalog/tenant/listings/${id}/stock\`, body)`
- `catalogTenant.adjustStock = (id, body) => c.patch(\`/catalog/tenant/listings/${id}/stock\`, body)`
- `catalogTenant.reserveStock = (id, body) => c.post(\`/catalog/tenant/listings/${id}/stock/reserve\`, body)`
- `catalogTenant.releaseStock = (id, body) => c.post(\`/catalog/tenant/listings/${id}/stock/release\`, body)`
- `catalogTenant.changeRequests = (q) => c.get('/catalog/tenant/change-requests', { query: q })`
- `catalogTenant.submitChangeRequest = (body) => c.post('/catalog/tenant/change-requests', body)`
- `catalogTenant.cancelChangeRequest = (id) => c.post(\`/catalog/tenant/change-requests/${id}/cancel\`)`
- `catalogTenant.reviseChangeRequest = (id, body) => c.post(\`/catalog/tenant/change-requests/${id}/revise\`, body)`
- `catalogTenant.bulkUpload = (kind, body) => c.post(\`/catalog/tenant/bulk/${kind}\`, body)`
- `catalogTenant.bulkJobs = (q) => c.get('/catalog/tenant/bulk/jobs', { query: q })`
- `catalogTenant.bulkJob = (id) => c.get(\`/catalog/tenant/bulk/jobs/${id}\`)`
- `catalogTenant.bulkTemplate = (kind) => c.get(\`/catalog/tenant/bulk/template/${kind}\`, { raw: true })`

- `media.rawUpload` is deliberately **not** added as a typed helper unless the local provider flow is retained; the current `MediaUploader` path already uses the presign/confirm flow.

### 0.2 Add a raw/download primitive to the shared client

- Extend `packages/shared/src/api/client.js` with a `raw: true` request option.
- On `raw: true`, return `{ data: res.blob(), headers, status }` and skip the `success` envelope check.
- Add `download` to the client wrapper.
- Add `frontend/apps/web/src/lib/download.js` with `saveDownload(response, filename)` using `URL.createObjectURL` + anchor click.
- Never expose a component-level `fetch`; CSV and template downloads must go through this helper.

### 0.3 Sidebar and route scaffolding

- Add new route groups in `components/layout/Sidebar.jsx` only when a feature page lands.
- Add `rider` to the role-aware `SidebarNav` and add `/rider` to `App.jsx` `HomeRedirect` and `RoleGuard` in Phase 3.

---

## Phase 1 — Fulfillment ops centre (P0, store admin)

**Files**

- `frontend/apps/web/src/features/ops/FulfillmentPage.jsx` — route `/fulfillment`
- `frontend/apps/web/src/features/ops/PickingQueue.jsx`
- `frontend/apps/web/src/features/ops/DeliveryQueue.jsx`
- `frontend/apps/web/src/features/ops/OrderOpsDrawer.jsx`
- `frontend/apps/web/src/features/ops/SlotGeneratorModal.jsx`
- `frontend/apps/web/src/features/ops/SlotUtilizationPanel.jsx`
- `frontend/apps/web/src/features/ops/ForecastPanel.jsx`
- `frontend/apps/web/src/features/ops/OpsPaymentDrawer.jsx`
- `frontend/apps/web/src/features/ops/opsMeta.js` — status → badge tone/text, action → icon/confirm text.

**Routes consumed**

- `GET /fulfillment/orders`
- `POST /fulfillment/orders/:id/pick`
- `POST /fulfillment/orders/:id/pack`
- `POST /fulfillment/orders/:id/dispatch`  (assign rider)
- `POST /fulfillment/orders/:id/deliver`  (POD type/value)
- `POST /fulfillment/orders/:id/delivery-failed`
- `POST /fulfillment/orders/:id/retry-delivery`
- `POST /fulfillment/slots/generate`  (`overwrite`, `forecast` flags)
- `GET /fulfillment/slots/utilization`
- `POST /fulfillment/slots/sweep`
- `POST /fulfillment/forecast`, `GET /fulfillment/forecast/upcoming`, `GET /fulfillment/forecast/history`
- `POST /fulfillment/assignments/sweep`
- `GET /fulfillment/payments`, `GET /fulfillment/payments/:id`
- `POST /fulfillment/reconcile/payments`

**Page behaviour**

- Tabs: **Picking → Delivery → Slots → Payments**.
- Picking tab: filter by status (`pending`, `picking`, `packed`, `ready`), search by order number/ID, columns `Order`, `Customer`, `Slot`, `Hub`, `Items`, `Status`, `Actions`; actions are `Start picking`, `Mark packed`.
- Delivery tab: filter by `assigned`, `out_for_delivery`, `delivery_failed`, `delivered`; dispatch calls the backend router auto-assignment (the API auto-chooses by hub) and immediately shows the returned `deliveryAssignment`; deliver opens a POD modal (`photo`, `otp`, `signature`, `reference`, `none`); failed/retry require a reason.
- Slots tab: date range + hub filter, utilisation grid, generate modal with `fromDate`, `toDate`, `hubId`, `capacity`, `overwrite`, `forecast`.
- Payments tab: payment list with status badges, payment detail drawer, and a guarded `Reconcile pending` button (calls `reconcilePayments`, shows returned counts, and **does not** auto-fail wallet payments — see risk note).

**Data shapes used**

- `/fulfillment/orders` item: `{ id, orderNumber, status, customer, deliverySlot, pickupHub, pickerId, riderId, pod, timeline, itemCount, totalAmount, createdAt }` (exact fields come from `adminOrdersService`); preserve the existing `OrderDetail` modal shape where possible.
- `/fulfillment/payments` item: `{ id, orderId, userId, method, status, amountPaise, gateway, failureReason, createdAt, updatedAt }`.
- Slots util row: `{ date, slots, capacity, reserved, fillRate }`.
- Forecast return: provider output plus `capacityBySlot`, `recommendedPickerCount`, `recommendedRiderCount`, `dryRun` flags.

**RBAC**

- Store role guard `['admin','super_admin']`, same as Orders.

**Risks / sequencing**

- Do **not** build a new order CRUD; reuse `OrdersPage` for read-only browsing and make the ops drawer the only place that mutates fulfilment state.
- `dispatch/deliver` are money/ops-sensitive; require confirm modals and show `statusHistory` after the action.
- Slot generation can mutate many rows. Always show `overwrite: false` by default and colour the result summary.
- `reconcile/payments` must remain an operator action with a count-oriented result card; never auto-run on page load.
- Backend already guarantees state-machine correctness; the UI must never call an invalid transition (disable buttons based on the previous status).

---

## Phase 2 — Returns, QC and manual refunds (P0, store admin/ops)

**Files**

- `frontend/apps/web/src/features/aftersales/AfterSalesPage.jsx` — route `/returns`
- `frontend/apps/web/src/features/aftersales/ReturnList.jsx`
- `frontend/apps/web/src/features/aftersales/ReturnDetailDrawer.jsx`
- `frontend/apps/web/src/features/aftersales/QCDecisionModal.jsx`
- `frontend/apps/web/src/features/aftersales/ManualRefundModal.jsx`
- `frontend/apps/web/src/features/aftersales/aftersalesMeta.js` — return status map, QC decision options, refund destination options.

**Routes consumed**

- `GET /fulfillment/returns`
- `GET /returns/:id`
- `POST /returns/:id/pickup`
- `POST /returns/:id/qc`
- `GET /fulfillment/refunds`
- `POST /fulfillment/refunds`  (manual admin refund)

**Page behaviour**

- Two tabs: **Return requests** and **Refunds**.
- Return list filters: `status`, `orderId`, `claimType` (`pickup_qc` / `instant_claim`), date range.
- Return detail drawer shows: order snapshot, returned items (`skuGlobal`, `title`, `qty`, `amount`), customer, pickup address, return reason/code, QC state, timeline.
- Actions: `Confirm pickup` (only when `approved`), `QC pass` / `QC fail` (only when `picked_up`), each with a required note for fail.
- Refunds tab shows `refunded`, `failed`, `pending`, `processing`; manual refund modal requires `orderId`, `amount`, `reason`, `destination`, optional `paymentId`, `userId`, `idempotencyKey`, `note`.

**Data shapes**

- Return list item: `{ id, orderId, userId, claimType, reason, reasonCode, status, items, refundAmount, createdAt }`.
- Detail: `{ returnRequest, items }`; item: `{ id, orderItemId, skuGlobal, title, qty, unitPrice, qcStatus, qcNote }`.
- Refund item: `{ id, orderId, userId, amount, destination, status, paymentId, initiatedBy, reason, createdAt }`.

**Risks / sequencing**

- Instant claims already auto-refund to wallet, so the admin must be able to distinguish them at a glance.
- `QC fail` should not offer refund actions and should drive the customer/order state visible in the timeline.
- Manual refunds duplicate the backend `refundService.initiate` guardrails; keep the form typed and pass `idempotencyKey` to prevent double-click duplicates.
- This phase should reuse the customer wallet/refund read surface (`api.shop.walletRefunds`) only inside a customer detail drawer, not as a separate page.

---

## Phase 3 — Rider delivery workspace (P1, rider/admin/super_admin)

**Files**

- `frontend/apps/web/src/features/rider/RiderDeliveryPage.jsx` — route `/rider`
- `frontend/apps/web/src/features/rider/DeliveryCard.jsx`
- `frontend/apps/web/src/features/rider/DeliveryTimeline.jsx`
- `frontend/apps/web/src/features/rider/PodCaptureModal.jsx`
- `frontend/apps/web/src/features/rider/AvailabilitySwitch.jsx`

**Routes consumed**

- `GET /rider/deliveries`
- `POST /rider/availability`
- `POST /rider/deliveries/:id/accept`
- `POST /rider/deliveries/:id/reject`
- `POST /rider/deliveries/:id/arrive-hub`
- `POST /rider/deliveries/:id/depart`
- `POST /rider/deliveries/:id/arrive`
- `POST /rider/deliveries/:id/complete`
- `POST /rider/deliveries/:id/fail`

**Page behaviour**

- Mobile-friendly queue of assigned deliveries.
- Each card: `orderNumber`, customer name/phone, address, pincode, hub, slot, item count, delivery assignment status.
- Action button flow is driven by assignment status: `assigned → accept/reject`, `accepted → arrive-hub`, `arrived_hub → depart`, `departed → arrive`, `arrived → complete/fail`.
- `complete` captures POD type/value; `fail` records a reason.
- Availability toggle (`available` / `busy` / `offline`) calls `rider.availability`.

**RBAC**

- `RoleGuard` roles `['rider','admin','super_admin']`.
- Update `HomeRedirect` so `role === 'rider'` lands on `/rider`.
- Update Sidebar: for `rider`, show a single `Rider` group with `Deliveries`.

**Risks / sequencing**

- This is the first real `rider` role screen; everything previously assumed a user with `admin`/`vendor` landing.
- Do not render customer phone outside a privileged guardian (the backend already authorises the route).
- Keep the state machine buttons disabled by status; no optimistic mutation without refetch.

---

## Phase 4 — Policies and coupon admin (P0, store admin)

**Files**

- `frontend/apps/web/src/features/policies/PoliciesPage.jsx` — route `/policies`
- `frontend/apps/web/src/features/policies/DeliveryFeePolicyCard.jsx`
- `frontend/apps/web/src/features/policies/TaxPolicyList.jsx`
- `frontend/apps/web/src/features/policies/CouponList.jsx`
- `frontend/apps/web/src/features/policies/CouponModal.jsx`
- `frontend/apps/web/src/features/policies/RefundPolicyPanel.jsx`
- `frontend/apps/web/src/features/policies/CouponPreviewModal.jsx`

**Routes consumed**

- `GET /policies/delivery-fee` / `POST /policies/delivery-fee` / `PATCH /policies/delivery-fee/:id`
- `GET /policies/tax` / `POST /policies/tax`
- `GET /policies/coupons` / `POST /policies/coupons`
- `GET /policies/refund` / `PATCH /policies/refund`
- `GET /policies/coupons/preview`

**Page behaviour**

- Delivery fee card: `name`, `baseFee`, `freeDeliveryThreshold`, `expressSurgeMultiplier`, `distanceFeePerKm`, `effectiveFrom/To`, `isActive`; create/edit in a Modal; the API makes the new policy active.
- Tax policy list: filter by `categoryId`, show `gstSlabPct`, `hsnCode`, effective window; upsert modal.
- Coupon list: `code`, `discountType` (`flat`/`percent`), `value`, `minCartValue`, `maxDiscountCap`, `usageLimitPerCustomer`, `validFrom/To`, `isPlatformWide`; create modal.
- Refund policy: `refundDeliveryFeeWhen` and `refundFeePct`; show current policy and a "draft only persisted on save" note.
- Coupon preview: input `code` + `cartSubtotal`, display the computed result (validation errors included).

**Data shapes**

- Fee policy: `{ id, name, baseFee, freeDeliveryThreshold, expressSurgeMultiplier, distanceFeePerKm, effectiveFrom, effectiveTo, isActive }`.
- Coupon: `{ id, code, discountType, value, minCartValue, maxDiscountCap, usageLimitPerCustomer, validFrom, validTo, isPlatformWide, status }`.

**Risks / sequencing**

- `POST /policies/delivery-fee` immediately activates a new policy; show that in the confirm text.
- Tax policies require a `categoryId`; provide a category picker sourced from `catalogAdmin.categoryTree`.
- Coupon production edits can affect live carts; disable editing `code` after creation and expose preview before publishing.

---

## Phase 5 — Search admin (P1, store admin)

**Files**

- `frontend/apps/web/src/features/search/SearchAdminPage.jsx` — route `/search`
- `frontend/apps/web/src/features/search/ProfileEditor.jsx`
- `frontend/apps/web/src/features/search/SynonymList.jsx`
- `frontend/apps/web/src/features/search/SearchHealthCard.jsx`
- `frontend/apps/web/src/features/search/SearchAnalyticsChart.jsx`

**Routes consumed**

- `GET /search/profiles` / `POST /search/profiles`
- `GET /search/synonyms` / `POST /search/synonyms`
- `POST /search/reindex`
- `GET /search/health`
- `GET /search/analytics`

**Page behaviour**

- Profiles: list with `code`, `name`, `isActive`, `trafficPct`, `weights`; editor exposes weighted factors (freshness, sales, availability, review score, etc.) as a slider range with normalisation hints.
- Synonyms: table of `term` / `synonyms`; add modal.
- Health: provider + freshness card, with `freshnessCheck` state, last index time, stale list, and an explicit `Run reindex` CTA.
- Analytics: date range selector; chart driven by `TrendChart` for zero-result rate, click rate, `impressions`, `queries`.

**Data shapes**

- Profile: `{ id, code, name, weights, trafficPct, isActive, updatedAt }`.
- Synonym: `{ id, term, synonyms, enabled }`.
- Health: `{ provider: {status, latencyMs, lastPing}, freshness: {status, lastIndexedAt, staleCount, repair:false} }`.
- Analytics: `{ totalQueries, zeroResultRate, clickRate, avgPosition, topQueries[], byDay[] }`.

**Risks / sequencing**

- `trafficPct` is a routing percentage; enforce a client-side “sum of active profiles must be ≤ 100%” guard but never silently mutate it.
- `reindex` can be heavy; require a modal with scope (`allTenants`) and show the returned job/task summary.
- Keep the public `api.shop.searchEvent` beacon out of this page; it is already wired in the storefront.

---

## Phase 6 — GST / tax admin (P1, store admin + super_admin)

**Files (store)**

- `frontend/apps/web/src/features/tax/TaxPage.jsx` — route `/tax`
- `frontend/apps/web/src/features/tax/RegistrationPanel.jsx` (`legalName`, `tradeName`, `gstin`, `pan`, `stateCode`, address, contact, `registrationType`, `turnoverBand`, `einvoiceEnabled`, `invoiceFooter/Terms`, `signatureUrl`, `status`)
- `frontend/apps/web/src/features/tax/DocumentList.jsx`
- `frontend/apps/web/src/features/tax/DocumentDetailDrawer.jsx`
- `frontend/apps/web/src/features/tax/IssueInvoiceModal.jsx`
- `frontend/apps/web/src/features/tax/CreditNoteModal.jsx`
- `frontend/apps/web/src/features/tax/SeriesAuditPanel.jsx`
- `frontend/apps/web/src/features/tax/StatutoryRateList.jsx`

**Files (platform)**

- `frontend/apps/web/src/features/platform/PlatformTaxPage.jsx` — route `/platform/tax`
- `frontend/apps/web/src/features/platform/TaxPolicyModal.jsx`
- `frontend/apps/web/src/features/platform/StatutoryRateModal.jsx`

**Routes consumed**

- Store: `GET/PUT /tax/registration`, `GET /tax/documents`, `GET /tax/documents/:id`, `POST /tax/documents/invoice`, `POST /tax/documents/credit-note`, `POST /tax/documents/:id/cancel`, `POST /tax/documents/:id/einvoice/retry`, `GET /tax/series/audit`.
- Platform: `GET /tax/policies`, `POST /tax/policies`, `GET /tax/statutory-rates`, `POST /tax/statutory-rates`.
- Customer-facing invoice link: `GET /tax/orders/:id/invoice` is already surfaced via the storefront order detail and should **not** be duplicated in admin.

**Page behaviour**

- Store tax page tabs: **Registration → Documents → Series audit → Statutory rates**.
- Documents table: `docType` (`invoice`, `credit_note`, `proforma`), `number`, `fyLabel`, `status`, `irn`, `ackNo`, `error`, `createdAt`; actions `Retry e-invoice`, `Cancel`, `Issue invoice`, `Issue credit note`.
- Document detail shows `orderNumber`, `buyer`, `totals`, tax lines, QR/IRN metadata, `supplierAddress`.
- Series audit: `ownerType`, `ownerId`, `docType`, `fyLabel`; render a gap/summary report.
- Platform tax page: rate policy list (`categoryId`, `rateBps`, `gstSlabPct`, `cessBps`, `natureOfSupply`, `hsnCode`, `effectiveFrom`) and statutory rates (`kind`, `rateBps`, `appliesTo`, `effectiveFrom`, `notificationRef`).

**Risks / sequencing**

- GST is a legal classification: standard platform policies and statutory rates are read-only outside `super_admin`.
- Store registration save should be dirty-state aware and show a “recheck after status change” hint.
- Cancel/credit-note are irreversible; require confirm modal with reason, never an inline destructive button.
- `retryEinvoice` is safe to expose but should display returned `irn`/`error` immediately.

---

## Phase 7 — Customer, staff and rider directory (P1, store admin)

**Files**

- `frontend/apps/web/src/features/users/UsersPage.jsx` — route `/users`
- `frontend/apps/web/src/features/users/UserDetailDrawer.jsx`
- `frontend/apps/web/src/features/users/CreateStaffModal.jsx`
- `frontend/apps/web/src/features/users/RiderStatsPage.jsx` — route `/users/riders` (or a tab)
- `frontend/apps/web/src/features/users/userMeta.js`

**Routes consumed**

- `GET /admin/users`
- `GET /admin/users/:id`
- `GET /admin/users/export.csv`
- `POST /admin/users/staff`
- `PATCH /admin/users/:id/status`
- `PATCH /admin/users/:id/role`
- `GET /admin/users/riders/stats`
- `GET /users/me/addresses` is **not** used here; admin detail aggregates addresses via `GET /admin/users/:id`.

**Page behaviour**

- User list filters: `search` (phone/email/name), `role`, `status`, date range.
- User detail drawer sections: profile/contact, addresses, wallet (from `admin.user` → `wallet`), order summary (`orders`, `gmv`, `recentOrders`), recent returns, staff actions.
- `CreateStaff` modal: role restricted to `admin | picker | rider`; for rider, optional `hubId`; password optional.
- Status and role changes call the respective endpoint with confirm + reason-in-audit note; self-change is disabled client-side.
- Rider stats tab: rows of `{ riderId, name, availability, status, delivered, rejections, avgDeliverySeconds, timeLogs }`; use `Stat` cards and a table.

**Data shapes**

- User list: `{ id, role, status, profile, phone, email, createdAt }`.
- User detail: `{ user, addresses, wallet, orderSummary, recentOrders, recentReturns }`.
- Rider stats: as above.

**Risks / sequencing**

- Never allow creating `super_admin` or promoting a user to `super_admin` from this page — mirror the backend guard in the form and show "not permitted".
- Disable status/role controls for the signed-in account.
- `Wallet` is sensitive; show balance/ledger but only link to customer-visible wallet history behind a well-scoped drawer, not a separate public route.

---

## Phase 8 — Inventory and hub depth (P1, store admin)

**Files**

- `frontend/apps/web/src/features/inventory/InventoryPage.jsx` — route `/inventory`
- `frontend/apps/web/src/features/inventory/InventoryLedgerDrawer.jsx`
- `frontend/apps/web/src/features/inventory/AdjustStockModal.jsx`
- `frontend/apps/web/src/features/inventory/InventoryExportButton.jsx`
- `frontend/apps/web/src/features/hubs/HubsPage.jsx` — route `/hubs`
- `frontend/apps/web/src/features/hubs/HubFormModal.jsx`
- `frontend/apps/web/src/features/hubs/PincodeEditorModal.jsx`
- `frontend/apps/web/src/features/hubs/SlotCapacityModal.jsx`

**Routes consumed**

- `GET /admin/inventory/summary`
- `GET /admin/inventory`
- `GET /admin/inventory/export.csv`
- `GET /admin/inventory/ledger/:id`
- `POST /admin/inventory/:id/adjust`
- `GET /admin/hubs`
- `POST /admin/hubs`
- `PATCH /admin/hubs/:id`
- `POST /admin/hubs/:id/toggle`
- `POST /admin/hubs/:id/pincodes`
- `GET /admin/slots`
- `POST /admin/slots/:id/override`
- `POST /admin/slots/:id/status`
- `GET /admin/slots/utilization`

**Page behaviour**

- Inventory page: summary cards (total skus, on-hand, reserved, available, health), filters, table `listingId`, `skuGlobal`, `title`, `mrp`, `sellingPrice`, `qtyOnHand`, `qtyReserved`, `available`, `health`, `restockSuggestion`; adjust-stock modal with `type` (`restock`,`shrinkage`,`audit`), `qtyChange`, `reason`, `note`; ledger drawer with timestamped movements.
- Hubs page: cards with `name`, `code`, `zoneId`, `address`, `defaultSlotCapacity`, `isActive`, `serviceablePincodes`; create/edit/toggle/pincode/slot capacity actions.
- Slot grid: date + hub filter, `effectiveCapacity`, `remaining`, `status`, override/close/reopen actions.

**Risks / sequencing**

- Inventory adjustments write ledger rows and move stock; require reason in the modal, never allow negative quantity without validating against `available`.
- Hub pincode management is service-area critical; show the current pincode chips and the add/remove diff before submit.
- `overrideSlot` can fail with `CAPACITY_BELOW_RESERVED`; render that API error clearly beside the capacity field.

---

## Phase 9 — Catalog admin depth (P2, store admin + super_admin)

**Files**

- `frontend/apps/web/src/features/catalog/ListingPage.jsx` — route `/catalog/listings`
- `frontend/apps/web/src/features/catalog/ListingFormModal.jsx`
- `frontend/apps/web/src/features/catalog/VariantPanel.jsx`
- `frontend/apps/web/src/features/catalog/ImagePanel.jsx` (extend `MasterDetailModal`)
- `frontend/apps/web/src/features/catalog/AttributeEditor.jsx`
- `frontend/apps/web/src/features/catalog/ChangeRequestsPage.jsx` — route `/catalog/change-requests`
- `frontend/apps/web/src/features/catalog/BulkUploadPage.jsx` — route `/catalog/bulk`
- `frontend/apps/web/src/features/catalog/CatalogAuditPanel.jsx`
- `frontend/apps/web/src/features/catalog/EventConsole.jsx`

**Routes consumed**

- `/catalog/tenant/listings` CRUD + stock + change requests + bulk
- `/catalog/admin/change-requests`, `/catalog/admin/audit`, `/catalog/admin/events/*`
- Existing `/catalog/admin/masters/:id/variants|images|attributes` already exist in the endpoint file; this phase wires them into the detail UI if not already present.

**Page behaviour**

- Listings table with price/status/stock actions; optimistic-lock errors surfaced as inline notices.
- Master detail: variants table (sku/price/stock/status), image uploader/reorder, attribute editor (label/value/unit/order).
- Change requests: review queue with before/after diff.
- Bulk: upload CSV, job table, job detail, template download; use the `raw` download helper from Phase 0.
- Audit panel: filter by entity/actor/action and render before/after JSON.
- Event console: `events/status` and `events/drain` as an ops-only panel (super_admin).

**Risks / sequencing**

- Catalog endpoint writes are optimistic-locked; every save must display `conflict` errors and offer reload.
- Bulk uploads can be large; show job status polling with backoff, never block the UI.
- Attribute changes can influence search/tax; show a review/lint panel before save.
- This phase is deliberately later: it depends on Phase 5/6/8 (search health, tax rates, inventory) to provide meaningful cues to the operator.

---

## Phase 10 — Platform lifecycle, KYC and ops automation (P2, super_admin)

**Files**

- `frontend/apps/web/src/features/platform/PlatformTenantDetailDrawer.jsx` (extend `PlatformStoresPage`)
- `frontend/apps/web/src/features/platform/PayoutKycReviewModal.jsx`
- `frontend/apps/web/src/features/platform/PlatformNotificationsPage.jsx` — route `/platform/notifications`
- `frontend/apps/web/src/features/platform/PlatformExportsPage.jsx` — route `/platform/exports`
- `frontend/apps/web/src/features/platform/PlatformMaintenancePanel.jsx`

**Routes consumed**

- `GET /marketplace/admin/tenants`, `GET /marketplace/admin/vendors/:id`, `GET /marketplace/admin/vendor-applications`
- `POST /payouts/admin/kyc/:vendorId/review`
- `POST /marketplace/admin/nightly`
- `POST /admin/maintenance/nightly`
- `POST /marketplace/admin/analytics/rebuild`
- `GET/POST /admin/notifications/templates`, `GET/POST /admin/notifications`, `POST /admin/notifications/process`
- `GET/POST /admin/exports`, `GET /admin/exports/:id`, `POST /admin/exports/:id/run`, `GET /admin/exports/:id/download`, `POST /admin/exports/run`
- Domain admin surface `api.domains.adminAll` is already exposed; surface it in a dedicated admin domain panel.

**Explicit backend gaps**

- There is **no route today** to suspend/activate or change the lifecycle of a platform tenant (`/marketplace/admin/tenants/:id` is read-only). Do **not** invent client actions against an absent endpoint. Phase 10 should ship:
  1. A read-only enhanced tenant drawer (plan, subscription state, store status, vendor count, recent invoices, domain count).
  2. A one-screen "platform backlog" that aggregates KYC review, nightly maintenance, notification job, export job and domain TLS failures.
  3. A clearly-labelled backend-gap note in the doc and UI tooltip: `Tenant suspend/activate — needs POST /marketplace/admin/tenants/:id/status (backend)`, then wire once available.
- Payout KYC review **is** supported today and should land in this phase because it is the platform's main compliance action.

**Page behaviour**

- Tenant drawer: identity, plan/subscription, state, billing, domain flags, and actions that are strictly allowed by the backend.
- `KYC review` modal: vendor ID, submitted KYC snapshot, `decision` (`approved`/`rejected`), note.
- Notifications: template list/create/edit/delete, send modal, process queue button.
- Exports: list, create, run, download, run-due; use the Phase 0 download helper.
- Maintenance panel: platform nightly, admin nightly, analytics rebuild, reindex (Phase 5 route can be called here as well), domain admin-all refresh.

**Risks / sequencing**

- All platform writes require confirmation with a reason and audit-visible summary.
- Never allow staging of a non-existent endpoint; the UI must not show a button that produces 404/405.
- Payout KYC review and payout cycle actions must not be mixed into the same permission surface without a clear distinction (vendor money vs platform compliance).
- Nightly jobs can be expensive; expose a result summary, not an endless spinner.

---

## Phase 11 — Cross-cutting polish and hardening (P2, all)

**Goal**: make the console feel production-grade rather than “a page per route”.

- **Empty/loading/error states**: add `EmptyState` and `Spinner` variants for every new table/drawer; standardise `useApi` error toasts.
- **Keyboard/primary action**: `Modal` focus trap already exists; ensure destructive actions use the danger variant.
- **Download UX**: use the Phase 0 raw client helper everywhere; show “preparing…” and then download the blob.
- **Searchable filters**: shared `FilterBar` component for date range + status + text filters.
- **RBAC smoke guard**: add a tiny dev-only route-map test listing `Route → allowed roles`.
- **Shared metadata**: move status maps into `packages/shared` so web and mobile stay aligned.
- **Build verification**: after each phase run `npm run build -w @flower-market/web`; keep the storefront build green.

---

## Completed work in the admin frontend (web)

Everything below is **shipped** as of this plan.

### Auth & shell
- `features/auth/LoginPage.jsx`, `features/auth/RegisterStorePage.jsx`, `features/auth/NoAccessPage.jsx`.
- Token/refresh/session handled by `packages/shared` client with single-flight refresh and retry.
- Role-aware `AppShell`, `Sidebar`, `RoleGuard` and `HomeRedirect` for `admin`, `super_admin`, `vendor`.

### Store dashboard
- `StoreDashboard`: KPI cards (GMV, orders, net revenue, AOV), `TrendChart` (GMV/orders), top products, subscription banners (`trial`, `past_due`, `no_plan`), CTA links.

### Catalog
- `CatalogPage`: SKU/title search, health filter, pagination, row detail modal, restock/shrinkage/audit inventory adjustment form.
- `MastersPage`, `CategoriesPage`, `BrandsPage` (tree/edit), `MasterFormModal`, `MasterDetailModal`, `ImageField`, `MediaPickerModal`, `MediaUploader`, master variants/images surface.

### Orders
- `OrdersPage`: status filter, order search, table, `OrderDetail` modal with items, totals and slot snapshot.

### Store vendors
- `StoreVendorsPage`: marketplace-mode banner, connect-vendor input, vendor cards with counters, idempotent `syncVendorProducts`.

### Billing (store)
- `StoreBillingPage`: subscription card, plan-change modal with marketplace badge, invoice list + detail modal.

### Storefront
- `BrandingPage`: name/tagline/description, logo/banner image fields, social links, publish toggle, live preview, onboarding status.
- `DomainsPage`: add domain modal, DNS record copy, verify/primary/remove, TLS status; `api.domains.adminAll` already exposed.

### Platform (super_admin)
- `PlatformOverview`: 7/30/90-day range, GMV/orders/net/commissions/MRR/active-tenants stats, by-plan badges, top stores/vendors, rebuild rollup.
- `PlatformStoresPage`: search/plan filter, tenant detail modal.
- `VendorApplicationsPage`: approve/reject with note, audited.
- `PlatformVendorsPage`: vendor list, product review approve/reject.
- `PlatformBillingPage`: invoice list, detail, pay/void modal, run billing cycle, overdue sweep.
- `PlansAdminPage`: create/edit plans, features, marketplace toggle, active/inactive.
- `LedgerPage`: accounts, trial balance, statement, journals, drift check/repair; account-code labels.
- `PlatformPayoutsPage`: payout batch list, state badges, waterfall, lines, adjustments, submit/approve/reject/cancel/send, cycle compute/hold/release/adjustment modals; `reviewKyc` endpoint is exposed in the shared client (KYC review UI itself is still to build in Phase 10).

### Vendor
- `VendorProfilePage`: business info, counters, GSTIN, metadata-only payout.
- `VendorProductsPage`: list + create modal.
- `VendorPayoutsPage`: upcoming/eligible/accruing/on-hold stats, statement modal with CSV download.
- `VendorPayoutAccountPage`: readiness checklist, UPI/bank destination, verify, KYC submit.

### Shared infrastructure
- `components/ui/*`: `Badge`, `Button`, `Card`, `EmptyState`, `Field`, `Modal`, `PageHeader`, `Pagination`, `Spinner`, `Stat`, `Table`, `Toaster`.
- `components/charts/TrendChart`, `components/media/*`, `lib/useApi.js`, `lib/toasts.js`, `lib/upload.js`, `lib/utils.js`.
- Shared client `packages/shared/src/api/endpoints.js` covers `auth`, `marketplace` (public/store/vendor/platform), `catalogAdmin`, `payouts`, `ledger`, `tax`, `domains`, `shop`, `search`, `media`, and core `admin` listing/inventory/adjust/orders/analytics.
- Both web and storefront builds are green.

---

## Suggested commit sequence

1. `feat(web): add shared endpoint parity and raw download helper` — Phase 0.
2. `feat(web): fulfillment ops centre` — Phase 1.
3. `feat(web): returns, QC and manual refunds` — Phase 2.
4. `feat(web): rider delivery workspace + rider landing` — Phase 3.
5. `feat(web): policies and coupon admin` — Phase 4.
6. `feat(web): search admin` — Phase 5.
7. `feat(web): GST and statutory tax admin` — Phase 6.
8. `feat(web): customer, staff and rider directory` — Phase 7.
9. `feat(web): inventory and hub depth` — Phase 8.
10. `feat(web): catalog admin depth` — Phase 9.
11. `feat(web): platform KYC, maintenance and ops automation` — Phase 10.
12. `feat(web): admin console polish and RBAC smoke coverage` — Phase 11.

Each commit should keep `npm run build -w @flower-market/web` green and, where the phase touches shared metadata, keep `packages/shared` and the storefront build green as well.
