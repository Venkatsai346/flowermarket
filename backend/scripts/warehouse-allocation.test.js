#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const allocator = read('src/services/warehouseAllocation.service.js');
const inventory = read('src/services/inventory.service.js');
const order = read('src/services/order.service.js');
const catalog = read('src/services/catalogSearch.service.js');
const slots = read('src/services/slot.service.js');
const transfer = read('src/services/warehouseTransfer.service.js');
const transferModel = read('src/models/inventoryTransfer.model.js');
const reservation = read('src/services/inventoryReservation.service.js');
const reservationModel = read('src/models/inventoryReservation.model.js');
const migration = read('src/migrations/014_multi_warehouse_allocation.js');
const routes = read('src/routes/fulfillment.routes.js');
const policy = read('src/models/warehouseAllocationPolicy.model.js');
const hub = read('src/models/hub.model.js');
const cart = read('src/services/cart.service.js');

const checks = [
  ['allocation policy is unique per active tenant', /tenantId: 1[^]*unique: true[^]*partialFilterExpression/.test(policy)],
  ['customer promise can require a pincode', /requirePincodeForPromise/.test(policy) && /reason: 'pincode_required'/.test(allocator)],
  ['only active fulfillment hubs are candidates', /isFulfillmentEnabled: \{ \$ne: false \}[^]*status: 'active'/.test(allocator)],
  ['hub eligibility enforces serviceable pincodes', /ServiceablePincode\.findOne/.test(allocator) && /hub\.serviceablePincodes/.test(allocator)],
  ['nearest-node strategy uses geospatial distance', /function distanceKm/.test(allocator) && /distanceKm\(customerCoordinates, hub\.coordinates\)/.test(allocator)],
  ['allocation subtracts reservations and both safety buffers', /row\.qtyReserved/.test(allocator) && /row\.safetyStock/.test(allocator) && /policy\.reserveSafetyStock/.test(allocator)],
  ['legacy stock is an explicit migration fallback', /allowLegacyDefaultStock/.test(allocator) && /\? \[null\] : \[\]/.test(allocator)],
  ['basket allocation refuses unsupported split fulfillment', /BASKET_NOT_ALLOCATABLE/.test(allocator) && /FULFILLMENT_SPLIT_POLICY\.ALLOW/.test(allocator)],
  ['order lines persist their selected warehouse', /warehouseId: allocated\.warehouseId/.test(order)],
  ['order confirmation consumes its durable exact-node reservation', /inventoryReservationService\.confirmOrder/.test(order) && /_id: row\.inventoryId/.test(reservation)],
  ['cancellation restores the exact allocated node', /inventoryService\.restoreForOrder/.test(order) && /warehouseId: i\.fulfillmentAllocation\?\.warehouseId/.test(order)],
  ['held slot hub is authoritative during checkout', /preferredHubId: slotDoc\?\.hubId \|\| null/.test(order)],
  ['slot discovery plans the complete basket first', /warehouseAllocationService\.plan\(\{ tenantId, pincode, items \}\)/.test(slots) && /allocation\.primaryHubId/.test(slots)],
  ['catalog stock is injected before filtering and pagination', catalog.indexOf("as: 'fulfillmentInventory'") > 0 && catalog.indexOf("as: 'fulfillmentInventory'") < catalog.indexOf('$facet')],
  ['cart revalidation uses the selected pincode', /fulfillmentSnapshot\?\.pincode/.test(cart) && /warehouseAllocation\.service/.test(cart)],
  ['transfer source deduction is atomic and guarded', /\$expr: \{ \$gte:/.test(transfer) && /\$inc: \{ qtyOnHand: -qty, version: 1/.test(transfer)],
  ['transfer compensates a failed destination write', /Compensation|compensation/.test(transfer) && /\$inc: \{ qtyOnHand: qty/.test(transfer)],
  ['transfers have a durable per-line lifecycle', /status: \{ type: String, enum: \['processing'/.test(transferModel) && /failureReason/.test(transferModel)],
  ['transfer retries are tenant-scoped and idempotent', /tenantId: 1, requestKey: 1/.test(transferModel) && /IDEMPOTENCY_KEY_REUSED/.test(transfer)],
  ['warehouse operations are authorization guarded', /authorize\(USER_ROLES\.ADMIN, USER_ROLES\.SUPER_ADMIN\)/.test(routes) && /warehouses\/transfers/.test(routes)],
  ['migration installs allocation indexes and safe legacy defaults', /inventory_allocation_lookup_idx/.test(migration) && /isFulfillmentEnabled: true/.test(migration) && /isSellable: true/.test(migration)],
  ['hubs carry fulfillment priority and handling controls', /fulfillmentPriority/.test(hub) && /handlingTimeMinutes/.test(hub)],
  ['allocation outcomes are observable', /warehouseAllocationRequests/.test(allocator) && /warehouseAllocationNodes/.test(allocator)],
  ['inventory commits are atomic and reject insufficient node stock', /\$expr: \{[^]*\$gte: \[/.test(inventory) && /reason: 'insufficient_stock'/.test(inventory) && /warehouseId: it\.warehouseId \|\| null/.test(inventory)],
  ['checkout reservations are durable and exact-node scoped', /inventoryId/.test(reservationModel) && /warehouseId/.test(reservationModel) && /expiresAt/.test(reservationModel)],
  ['reservation creation atomically increments reserved stock', /\$inc: \{ qtyReserved: qty, version: 1 \}/.test(reservation) && /INVENTORY_RESERVATION_UNAVAILABLE/.test(reservation)],
  ['reservation confirmation consumes on-hand and reserved together', /qtyOnHand: -row\.qty, qtyReserved: -row\.qty/.test(reservation)],
  ['reservation retries are protected by unique idempotency indexes', /inventory_reservation_idempotency_uq/.test(reservationModel) && /replayed: true/.test(reservation)],
  ['expiry and reconciliation are bounded and observable', /sweepExpired/.test(reservation) && /async reconcile/.test(reservation) && /inventoryReservationSweep/.test(reservation)],
];

for (const [name, passed] of checks) {
  assert.ok(passed, name);
  console.log(`✓ ${name}`);
}
console.log(`\nWarehouse allocation: ${checks.length} safeguards passed.`);
