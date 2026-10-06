import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bulkImportService from '../src/services/bulkImport.service.js';
import { up as createBulkIndexes } from '../src/migrations/009_durable_catalog_bulk_jobs.js';

const oid = (suffix) => new mongoose.Types.ObjectId(`66c00000000000000000${suffix}`);
const tenantId = oid('0001');
const otherTenantId = oid('0002');
const actorId = oid('0003');
const masterId = oid('0010');
const listingId = oid('0020');

let mongod = null;
let mongoUri = process.env.MONGODB_URI || null;
if (!mongoUri) {
  try {
    mongod = await MongoMemoryServer.create();
    mongoUri = mongod.getUri();
  } catch (error) {
    if (error?.name === 'DownloadError' || error?.code === 'ECONNRESET') {
      console.log('durable catalog bulk integration: SKIP (local mongod unavailable; CI uses MongoDB service)');
      process.exit(0);
    }
    throw error;
  }
}

try {
  await mongoose.connect(mongoUri, { dbName: 'catalog-bulk-durable' });
  const db = mongoose.connection.db;
  await db.dropDatabase();
  await createBulkIndexes(db);
  await db.collection('productmasters').insertOne({
    _id: masterId, title: 'Rose Bunch', slug: 'rose-bunch', skuGlobal: 'ROSE-10', status: 'active', isDeleted: false, version: 1,
  });
  await db.collection('tenantproducts').insertOne({
    _id: listingId, tenantId, productMasterId: masterId, variantId: null, status: 'active', isDeleted: false,
    price: { sellingPrice: 299, mrp: 399, currency: 'INR' }, version: 1, createdAt: new Date(), updatedAt: new Date(),
  });

  const created = await bulkImportService.createJob({
    kind: 'price', tenantId, actorId, dryRun: true,
    rows: [{ listingId: String(listingId), price: '349', mrp: '449' }, { sku: 'NOT-YET-THERE', price: '99', mrp: '120' }],
  });
  assert.match(created.id, /^[a-f0-9]{24}$/);
  await bulkImportService.processAvailable({ workerId: 'integration-worker', maxJobs: 1 });
  let job = await bulkImportService.getJob(created.id, { tenantId });
  assert.equal(job.status, 'completed');
  assert.equal(job.processed, 2);
  assert.equal(job.succeeded, 1);
  assert.equal(job.failed, 1);
  const failures = await bulkImportService.listFailures({ jobId: created.id, tenantId });
  assert.equal(failures.items.length, 1);
  assert.equal(failures.items[0].rowNumber, 3);
  assert.equal(failures.items[0].errorCode, 'LISTING_NOT_FOUND');
  await assert.rejects(() => bulkImportService.getJob(created.id, { tenantId: otherTenantId }), (error) => error.code === 'JOB_NOT_FOUND');

  await db.collection('productmasters').insertOne({
    _id: oid('0011'), title: 'Future SKU', slug: 'future-sku', skuGlobal: 'NOT-YET-THERE', status: 'active', isDeleted: false, version: 1,
  });
  await bulkImportService.retryFailures({ jobId: created.id, tenantId });
  await bulkImportService.processAvailable({ workerId: 'integration-worker', maxJobs: 1 });
  job = await bulkImportService.getJob(created.id, { tenantId });
  assert.equal(job.status, 'completed');
  assert.equal(job.succeeded, 2);
  assert.equal(job.failed, 0);

  const cancellable = await bulkImportService.createJob({
    kind: 'stock', tenantId, actorId, dryRun: true, rows: [{ listingId: String(listingId), qty: '10' }],
  });
  const cancelled = await bulkImportService.cancelJob({ jobId: cancellable.id, tenantId });
  assert.equal(cancelled.status, 'cancelled');

  console.log('durable catalog bulk integration passed');
} finally {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}
