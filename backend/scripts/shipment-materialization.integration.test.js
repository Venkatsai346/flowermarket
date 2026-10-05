import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createHermeticMongo, stopHermeticMongo } from './lib/hermeticMongo.js';
import Hub from '../src/models/hub.model.js';
import OrderItem from '../src/models/orderItem.model.js';
import Shipment from '../src/models/shipment.model.js';
import ShipmentItem from '../src/models/shipmentItem.model.js';
import FulfillmentTask from '../src/models/fulfillmentTask.model.js';
import shipmentService from '../src/services/shipment.service.js';

let mongod = null;
let mongoUri = process.env.MONGODB_URI || null;
if (!mongoUri) {
  try {
    mongod = await createHermeticMongo();
    mongoUri = mongod.getUri();
  } catch (error) {
    if (error?.name === 'DownloadError' || error?.code === 'ECONNRESET' || /Could not start an in-memory mongod/.test(error?.message || '')) {
      console.log('shipment materialization integration: SKIP (local mongod unavailable; CI uses MongoDB service)');
      process.exit(0);
    }
    throw error;
  }
}

try {
  await mongoose.connect(mongoUri, { dbName: 'shipment-materialization-integration' });
  await mongoose.connection.db.dropDatabase();
  await Promise.all([Hub.init(), OrderItem.init(), Shipment.init(), ShipmentItem.init(), FulfillmentTask.init()]);

  const tenantId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();
  const [hubA, hubB] = await Hub.create([
    { tenantId, name: 'Primary Hub', code: 'PRIMARY' },
    { tenantId, name: 'Overflow Hub', code: 'OVERFLOW' },
  ]);
  const listingA = new mongoose.Types.ObjectId();
  const listingB = new mongoose.Types.ObjectId();
  const masterA = new mongoose.Types.ObjectId();
  const masterB = new mongoose.Types.ObjectId();
  const [lineA, lineB] = await OrderItem.create([
    {
      tenantId, orderId, tenantProductId: listingA, productMasterId: masterA,
      skuSnapshot: { title: 'Line A' }, priceAtOrder: { sellingPrice: 100 },
      qty: 1, lineTotal: 100, taxAmount: 5, discountAllocated: 10,
      fulfillmentAllocation: { warehouseId: hubA._id, quantity: 1 },
    },
    {
      tenantId, orderId, tenantProductId: listingB, productMasterId: masterB,
      skuSnapshot: { title: 'Line B' }, priceAtOrder: { sellingPrice: 200 },
      qty: 2, lineTotal: 400, taxAmount: 20, discountAllocated: 0,
      fulfillmentAllocation: { warehouseId: hubB._id, quantity: 2 },
    },
  ]);
  const order = {
    _id: orderId, tenantId, orderNumber: 'FM-SPLIT-001', deliveryFee: 49,
  };
  const allocation = {
    primaryHubId: String(hubA._id),
    allocations: [
      { listingId: String(listingA), fulfillmentHubId: String(hubA._id), warehouseId: hubA._id },
      { listingId: String(listingB), fulfillmentHubId: String(hubB._id), warehouseId: hubB._id },
    ],
    shipments: [
      { fulfillmentHubId: String(hubA._id), warehouseCode: hubA.code, listingIds: [String(listingA)] },
      { fulfillmentHubId: String(hubB._id), warehouseCode: hubB.code, listingIds: [String(listingB)] },
    ],
  };

  const first = await shipmentService.createForOrder({ order, orderItems: [lineA, lineB], allocation });
  const replay = await shipmentService.createForOrder({ order, orderItems: [lineA, lineB], allocation });
  assert.equal(first.length, 2);
  assert.equal(replay.length, 2);
  assert.equal(await Shipment.countDocuments({ tenantId, orderId }), 2, 'replay must not duplicate shipments');
  assert.equal(await ShipmentItem.countDocuments({ tenantId, orderId }), 2, 'replay must not duplicate immutable shipment items');
  assert.equal((await Shipment.find({ tenantId, orderId })).reduce((sum, row) => sum + Math.round(row.deliveryFee * 100), 0), 4900, 'fee shares reconcile to the paisa');
  assert.equal(await OrderItem.countDocuments({ tenantId, orderId, shipmentId: { $ne: null } }), 2, 'every line has exactly one durable owner');

  await shipmentService.queueForOrder({ tenantId, orderId });
  await shipmentService.queueForOrder({ tenantId, orderId });
  assert.equal(await FulfillmentTask.countDocuments({ tenantId, orderId }), 2, 'queue replay must keep one task per shipment');
  assert.equal(await Shipment.countDocuments({ tenantId, orderId, status: 'queued' }), 2);

  const picking = await Shipment.findOne({ tenantId, orderId, sequence: 1 });
  picking.status = 'picking';
  await picking.save();
  await shipmentService.queueForOrder({ tenantId, orderId });
  assert.equal((await Shipment.findById(picking._id)).status, 'picking', 'queue replay must never regress an executing shipment');

  await assert.rejects(
    () => shipmentService.createForOrder({
      order,
      orderItems: [lineA, lineB],
      allocation: { ...allocation, shipments: [{ ...allocation.shipments[0], listingIds: [String(listingA), String(listingB)] }, allocation.shipments[1]] },
    }),
    (error) => error.code === 'INVALID_SHIPMENT_PLAN',
  );

  console.log('shipment materialization integration: replay, ownership, fees, and task cardinality passed');
} finally {
  await mongoose.disconnect().catch(() => {});
  await stopHermeticMongo(mongod);
}
