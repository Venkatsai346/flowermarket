# Fulfillment Orchestration V2 — split fulfillment

## Invariants

- A checkout reservation belongs to the exact `(tenant, order, listing, warehouse)` selected by allocation.
- The held delivery-slot hub remains a required participant. Overflow hubs may supplement it only when the tenant's split policy is `allow`.
- The planner minimizes shipment count before allocation rank and distance. Candidate enumeration is bounded by `maxCandidateHubs`.
- A complete order line is owned by exactly one shipment. This release does not split the quantity of one SKU across hubs.
- Shipment items are immutable financial and fulfillment ownership records. Delivery-fee shares reconcile to the order fee at paise precision.
- Fulfillment tasks and rider assignments are unique per shipment, not per order.
- Order status is derived from all non-cancelled shipments. `partially_delivered` means at least one, but not every, active shipment arrived.
- Legacy order-scoped execution routes fail with `SHIPMENT_ID_REQUIRED` when an order has multiple shipments.

## Lifecycle

`planned → queued → picking → packed → out_for_delivery → delivered`

`out_for_delivery → delivery_failed → out_for_delivery` supports retry. Pre-dispatch states can transition to `cancelled` through the customer shipment cancellation API. Picking, packing, rider assignment, POD, tracking, promises, and fees are shipment-scoped.

## APIs

Operations use:

- `POST /fulfillment/orders/:orderId/shipments/:shipmentId/pick`
- `POST /fulfillment/orders/:orderId/shipments/:shipmentId/pack`
- `POST /fulfillment/orders/:orderId/shipments/:shipmentId/dispatch`
- `POST /fulfillment/orders/:orderId/shipments/:shipmentId/deliver`
- `POST /fulfillment/orders/:orderId/shipments/:shipmentId/delivery-failed`
- `POST /fulfillment/orders/:orderId/shipments/:shipmentId/retry-delivery`

Customers use `POST /orders/:orderId/shipments/:shipmentId/cancel`. It is intentionally unavailable for COD partials: the current COD ledger has one order-level receivable and must not pretend it can waive only one parcel. Prepaid cancellation atomically restores the exact committed node stock, marks the immutable line allocations cancelled, and starts an idempotent component refund keyed by shipment.

## Cancellation and returns

A prepaid shipment may be cancelled only before dispatch. Inventory restoration and durable cancellation markers share one MongoDB transaction. Refund execution follows the commit and is replay-safe through `shipment_cancel:<shipmentId>`.

Return requests must contain lines from one shipment. Eligibility uses that shipment's actual `deliveredAt`, so a delivered first parcel can be returned while a second parcel remains in transit. Cancelled quantities cannot be returned. Return progress no longer overwrites the fulfillment aggregate for shipment-backed orders.

## Deployment

Run migration `016_split_fulfillment_shipments.js` before deploying API instances. It removes legacy order-only unique indexes and creates shipment, shipment-item, task, assignment, and ownership indexes. Production MongoDB must be a replica set because partial cancellation uses transactions.

Monitor:

- shipments whose promise maximum is overdue and status is not terminal;
- shipments without exactly one fulfillment task after payment confirmation;
- shipment item totals that do not equal the order's immutable item totals;
- cancelled shipments whose `cancellation.refundStatus` remains `pending` or `failed`;
- order status drift from the deterministic shipment aggregate;
- delivery assignments stuck past `pendingAcceptExpiresAt`.
