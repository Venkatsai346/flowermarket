# Durable inventory reservations

## Invariant

A customer must own an exact-node stock hold before payment begins. At every inventory row:

`qtyReserved <= qtyOnHand - nodeSafetyStock - policySafetyStock`

Reservation confirmation atomically decrements both `qtyOnHand` and `qtyReserved`. Release or expiry decrements only `qtyReserved`. Cancellation restores `qtyOnHand` only when a reservation was already confirmed. This distinction prevents both overselling and stock creation.

## Lifecycle

`allocating → active → confirmed`

or

`allocating → active → released | expired`

Every line stores tenant, order, customer, listing, exact inventory row, warehouse, quantity, safety-policy snapshot, expiration, transition history, and an idempotency key. Terminal rows are retained for audit; no TTL deletion is used.

Checkout uses one idempotency key across order creation, reservation, and payment. A tenant/customer/key unique index prevents duplicate orders, while reservation line indexes prevent duplicate holds. Reusing a key with different checkout details fails closed.

## Concurrency and topology

Replica-set deployments use MongoDB transactions with snapshot reads and majority writes for each basket operation. Production refuses reservation writes when transactions are unavailable. Standalone development uses deterministic compensation so local workflows remain usable, while reconciliation exposes interrupted fallback operations.

## Expiry and reconciliation

The worker runs an expiry sweep approximately once per minute. Nightly maintenance runs both expiry and reconciliation. Expiry releases abandoned payment-window holds but does not guess gateway state; gateway-aware payment reconciliation remains authoritative. A payment captured after expiry is refunded rather than silently reacquiring stock.

Reconciliation reports:

- active holds attached to terminal orders;
- missing inventory rows;
- reserved-quantity drift;
- interrupted `allocating` records;
- missing orders.

Only unambiguous terminal-order leaks are auto-repaired. Ambiguous counter drift remains visible for operator investigation.

## Operations

- `GET /fulfillment/warehouses/reservations`
- `POST /fulfillment/warehouses/reservations/sweep`
- `POST /fulfillment/warehouses/reservations/reconcile`

The admin Inventory page includes a reservation control tower with lifecycle counts, recent holds, expiry actions, and reconciliation controls.

Metrics:

- `inventory_reservation_operations_total`
- `inventory_reservation_operation_seconds`
- `inventory_reservation_sweep_total`

## Configuration

- `INVENTORY_RESERVATION_TTL_MINUTES` — default 20, bounded 5–120.
- `INVENTORY_RESERVATION_SWEEP_BATCH_SIZE` — default 100.
- `INVENTORY_RESERVATION_RECONCILE_BATCH_SIZE` — default 200.

The reservation TTL should exceed the expected gateway checkout window and be coordinated with payment reconciliation policy.

## Deployment

1. Ensure production MongoDB is a replica set or sharded transaction-capable topology.
2. Apply migration `015_durable_inventory_reservations.js` before API rollout.
3. Deploy API and worker together.
4. Verify worker heartbeat and reservation sweep metrics.
5. Canary by tenant and watch reservation failures, expirations, payment latency, refunds, and drift.
6. Do not manually reduce `qtyReserved`; use reconciliation and investigate its backing reservation records.
