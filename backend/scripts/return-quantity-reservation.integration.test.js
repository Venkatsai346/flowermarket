import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createHermeticMongo, stopHermeticMongo } from './lib/hermeticMongo.js';
import OrderItem from '../src/models/orderItem.model.js';
import returnsService from '../src/services/returns.service.js';

let mongod = null;
let mongoUri = process.env.MONGODB_URI || null;
if (!mongoUri) {
  try {
    mongod = await createHermeticMongo();
    mongoUri = mongod.getUri();
  } catch (error) {
    if (error?.name === 'DownloadError' || error?.code === 'ECONNRESET' || /Could not start an in-memory mongod/.test(error?.message || '')) {
      console.log('return quantity reservation integration: SKIP (local mongod unavailable; CI uses MongoDB service)');
      process.exit(0);
    }
    throw error;
  }
}

try {
  await mongoose.connect(mongoUri, { dbName: 'return-quantity-reservation-integration' });
  await mongoose.connection.db.dropDatabase();
  await OrderItem.init();

  const tenantId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();
  const [line] = await OrderItem.create([{
    tenantId, orderId,
    tenantProductId: new mongoose.Types.ObjectId(),
    productMasterId: new mongoose.Types.ObjectId(),
    skuSnapshot: { title: 'Concurrency-safe line' },
    priceAtOrder: { sellingPrice: 100 }, qty: 1, lineTotal: 100,
  }]);
  const claim = () => returnsService.reserveQuantities({
    tenantId, orderId, orderItems: [line],
    requestedItems: [{ orderItemId: String(line._id), qty: 1 }],
  });

  const attempts = await Promise.allSettled([claim(), claim()]);
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1,
    'exactly one concurrent request may reserve the delivered unit');
  assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(attempts.find((result) => result.status === 'rejected').reason.code, 'RETURN_QUANTITY_ALREADY_CLAIMED');
  assert.equal((await OrderItem.findById(line._id).lean()).returnRequestedQty, 1);

  const winner = attempts.find((result) => result.status === 'fulfilled').value;
  await returnsService.releaseReservations({ tenantId, orderId, reservations: winner });
  assert.equal((await OrderItem.findById(line._id).lean()).returnRequestedQty, 0,
    'compensation must release only the quantity reserved by this attempt');

  await assert.rejects(
    () => returnsService.reserveQuantities({
      tenantId: new mongoose.Types.ObjectId(), orderId, orderItems: [line],
      requestedItems: [{ orderItemId: String(line._id), qty: 1 }],
    }),
    (error) => error.code === 'RETURN_QUANTITY_ALREADY_CLAIMED',
    'reservation CAS must be tenant scoped',
  );

  console.log('return quantity reservation integration: concurrency, compensation, and tenant isolation passed');
} finally {
  await mongoose.disconnect().catch(() => {});
  await stopHermeticMongo(mongod);
}
