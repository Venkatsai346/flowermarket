import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createHermeticMongo, stopHermeticMongo } from './lib/hermeticMongo.js';
import Hub from '../src/models/hub.model.js';
import Inventory from '../src/models/inventory.model.js';
import InventoryTransfer from '../src/models/inventoryTransfer.model.js';
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
  await Promise.all([Hub.init(), Inventory.init(), InventoryTransfer.init()]);

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

  console.log('Warehouse allocation integration: transfer lifecycle, node integrity, and idempotency passed.');
} finally {
  await mongoose.disconnect().catch(() => {});
  await stopHermeticMongo(mongod);
}
