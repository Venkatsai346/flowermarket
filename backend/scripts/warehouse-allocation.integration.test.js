import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createHermeticMongo, stopHermeticMongo } from './lib/hermeticMongo.js';
import Hub from '../src/models/hub.model.js';
import Inventory from '../src/models/inventory.model.js';
import InventoryTransfer from '../src/models/inventoryTransfer.model.js';
import InventoryReservation from '../src/models/inventoryReservation.model.js';
import inventoryReservationService from '../src/services/inventoryReservation.service.js';
import warehouseTransferService from '../src/services/warehouseTransfer.service.js';

let mongod = null;
let mongoUri = process.env.MONGODB_URI || null;
if (!mongoUri) {
  try {
    mongod = await createHermeticMongo();
    mongoUri = mongod.getUri();
  } catch (error) {
    if (error?.name === 'DownloadError' || error?.code === 'ECONNRESET' || /Could not start an in-memory mongod/.test(error?.message || '')) {
      console.log('warehouse allocation integration: SKIP (local mongod unavailable; CI uses MongoDB service)');
      process.exit(0);
    }
    throw error;
  }
}

try {
  await mongoose.connect(mongoUri, { dbName: 'warehouse-allocation-integration' });
  await mongoose.connection.db.dropDatabase();
  await Promise.all([Hub.init(), Inventory.init(), InventoryTransfer.init(), InventoryReservation.init()]);

  const tenantId = new mongoose.Types.ObjectId();
  const actorId = new mongoose.Types.ObjectId();
  const listingId = new mongoose.Types.ObjectId();
  const [source, destination] = await Hub.create([
    { tenantId, name: 'Source Hub', code: 'SOURCE' },
    { tenantId, name: 'Destination Hub', code: 'DEST' },
  ]);
  await Inventory.create({
    tenantId, tenantProductId: listingId, warehouseId: source._id,
    qtyOnHand: 10, qtyReserved: 2, safetyStock: 1,
  });

  const input = {
    tenantId, fromHubId: source._id, toHubId: destination._id,
    items: [{ tenantProductId: listingId, qty: 4 }], actorId,
    idempotencyKey: 'warehouse-transfer-test-001',
  };
  const first = await warehouseTransferService.initiate(input);
  assert.equal(first.idempotentReplay, false);
  assert.equal(first.transfer.status, 'completed');
  assert.equal(first.transferred.length, 1);
  assert.equal((await Inventory.findOne({ warehouseId: source._id })).qtyOnHand, 6);
  assert.equal((await Inventory.findOne({ warehouseId: destination._id })).qtyOnHand, 4);

  const replay = await warehouseTransferService.initiate(input);
  assert.equal(replay.idempotentReplay, true);
  assert.equal((await Inventory.findOne({ warehouseId: source._id })).qtyOnHand, 6, 'replay must not deduct twice');
  assert.equal((await Inventory.findOne({ warehouseId: destination._id })).qtyOnHand, 4, 'replay must not credit twice');
  assert.equal(await InventoryTransfer.countDocuments({ tenantId }), 1);

  await assert.rejects(
    () => warehouseTransferService.initiate({ ...input, items: [{ tenantProductId: listingId, qty: 3 }] }),
    (error) => error.code === 'IDEMPOTENCY_KEY_REUSED',
  );

  const shortage = await warehouseTransferService.initiate({
    ...input, idempotencyKey: 'warehouse-transfer-test-002',
    items: [{ tenantProductId: listingId, qty: 99 }],
  });
  assert.equal(shortage.transfer.status, 'failed');
  assert.equal(shortage.failed[0].reason, 'insufficient_stock');
  assert.equal((await Inventory.findOne({ warehouseId: source._id })).qtyOnHand, 6);

  // Durable payment-window reservation: exact node, replay-safe, and converted
  // atomically from reserved quantity into physical consumption.
  const reservationOrderId = new mongoose.Types.ObjectId();
  const productMasterId = new mongoose.Types.ObjectId();
  await mongoose.connection.db.collection('orders').insertOne({
    _id: reservationOrderId, tenantId, userId: actorId, orderNumber: 'RES-001',
    status: 'created', checkoutIdempotencyKey: 'checkout-reservation-001',
    checkoutFingerprint: 'a'.repeat(64), fulfillmentPlan: { status: 'planned' },
    createdAt: new Date(), updatedAt: new Date(),
  });
  await mongoose.connection.db.collection('orderitems').insertOne({
    _id: new mongoose.Types.ObjectId(), orderId: reservationOrderId, tenantId,
    tenantProductId: listingId, productMasterId, qty: 2, lineTotal: 20,
    skuSnapshot: { title: 'Reserved listing' }, priceAtOrder: { sellingPrice: 10, currency: 'INR' },
    fulfillmentAllocation: { warehouseId: source._id, quantity: 2, policySafetyStockAtPlan: 1 },
    createdAt: new Date(), updatedAt: new Date(),
  });
  const held = await inventoryReservationService.reserveOrder({
    tenantId, orderId: reservationOrderId, userId: actorId,
    idempotencyKey: 'checkout-reservation-001', actorId,
  });
  assert.equal(held.replayed, false);
  assert.equal(held.reservations[0].status, 'active');
  assert.equal((await Inventory.findOne({ warehouseId: source._id })).qtyReserved, 4);
  const heldReplay = await inventoryReservationService.reserveOrder({
    tenantId, orderId: reservationOrderId, userId: actorId,
    idempotencyKey: 'checkout-reservation-001', actorId,
  });
  assert.equal(heldReplay.replayed, true);
  assert.equal((await Inventory.findOne({ warehouseId: source._id })).qtyReserved, 4, 'reservation replay must not hold twice');
  await inventoryReservationService.confirmOrder({ tenantId, orderId: reservationOrderId, actorId });
  const afterConfirm = await Inventory.findOne({ warehouseId: source._id });
  assert.equal(afterConfirm.qtyOnHand, 4);
  assert.equal(afterConfirm.qtyReserved, 2);
  assert.equal((await InventoryReservation.findOne({ orderId: reservationOrderId })).status, 'confirmed');
  const confirmationReplay = await inventoryReservationService.confirmOrder({ tenantId, orderId: reservationOrderId, actorId });
  assert.equal(confirmationReplay.replayed, true);
  assert.equal((await Inventory.findOne({ warehouseId: source._id })).qtyOnHand, 4, 'confirmation replay must not consume twice');

  console.log('Warehouse allocation integration: transfers and durable reservation lifecycle passed.');
} finally {
  await mongoose.disconnect().catch(() => {});
  await stopHermeticMongo(mongod);
}
