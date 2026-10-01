# Multi-warehouse inventory and fulfillment

## Operating contract

Inventory is physical stock at a fulfillment node. `Inventory.warehouseId` identifies that node; a `null` warehouse is a temporary legacy migration pool, not an arbitrary warehouse. Customer-sellable quantity is calculated per eligible node as:

`max(0, qtyOnHand - qtyReserved - nodeSafetyStock - policySafetyStock)`

Network physical stock and customer-allocatable stock are intentionally different values. Catalog availability, carts, delivery slots, checkout, order lines, fulfillment tasks, cancellation restoration, and admin inventory all preserve this distinction.

## Allocation policy

Each tenant has one active `WarehouseAllocationPolicy`. Operators can configure:

- nearest available, service-hub, or priority-then-distance selection;
- safety stock reserved at every candidate node;
- whether a pincode is required for a customer promise;
- temporary legacy-default-pool fallback;
- candidate-node limits and default handling time;
- split policy. Split execution is fail-closed until the order/fulfillment model supports multiple tasks per order.

A hub must be active and fulfillment-enabled. Pincode serviceability, the pincode's primary hub, curated hub pincodes, overflow eligibility, radius, priority, coordinates, handling time, and exact node inventory influence eligibility, ranking, and promises. A held slot's hub is authoritative during checkout.

## Durable order truth

Allocation is recalculated before order creation. The selected node and promise are snapshotted on the order and each line. Stock commitment and cancellation restoration target exactly that warehouse row with atomic stock guards; no code chooses an arbitrary inventory row.

`TenantProduct.stockQty` remains a network search/index hint. It is refreshed after node mutations but is never authoritative for a pincode-specific sale.

## Transfers

`POST /fulfillment/warehouses/transfers` accepts an `Idempotency-Key` header or `idempotencyKey` body field. Reusing a key with the same request returns the original transfer and does not move stock twice. Reusing it with a different payload fails with `IDEMPOTENCY_KEY_REUSED`.

Each transfer and line has a durable status in `inventorytransfers`. Source deduction is atomic and reservation-aware. A destination-write failure compensates the source before it is recorded as failed. Operators can inspect records through:

- `GET /fulfillment/warehouses/transfers`
- `GET /fulfillment/warehouses/transfers/:transferId`

For cross-region/asynchronous logistics, extend this lifecycle with dispatch/receive custody events rather than weakening the synchronous transfer invariant.

## Deployment

1. Back up MongoDB and test migration `014_multi_warehouse_allocation.js` in staging.
2. Run `npm run db:migrate` before API rollout.
3. Configure hub coordinates, fulfillment priority, handling time, serviceable pincodes, and stock rows.
4. Keep `allowLegacyDefaultStock=true` while inventory is moved from the null pool to explicit hubs.
5. Compare network physical stock with node totals, then disable legacy fallback per tenant.
6. Monitor `warehouse_allocation_requests_total` and `warehouse_allocation_candidate_nodes` for shortages, serviceability gaps, and candidate growth.

## Validation

```bash
cd backend
npm run lint
npm run test:warehouse-allocation
npm run test:warehouse-allocation:integration
npm run test:invariants
npm run test:unit

cd ../frontend
npm test
npm run build
```

The integration suite uses the repository's hermetic MongoDB helper and skips locally only when the MongoDB binary cannot be downloaded; CI should run it against its MongoDB service.

## Incident guidance

- Rising `no_node`: verify pincode rows, hub activation, curated pincodes, overflow radius, and coordinates.
- Rising `basket_shortage`: inspect per-node stock, reservations, both safety buffers, and whether assortment is fragmented across hubs.
- Transfer stuck in `processing`: stop retries with new keys, inspect the durable line statuses and both inventory rows, reconcile the incomplete line, and retain the record for audit.
- Promise drift: verify hub handling time and customer coordinates; never silently substitute network stock for node stock.
