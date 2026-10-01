import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import catalogQualityService from '../src/services/catalogQuality.service.js';
import { up as createQualityIndexes } from '../src/migrations/010_durable_catalog_quality_runs.js';

const oid = (suffix) => new mongoose.Types.ObjectId(`66e00000000000000000${suffix}`);
const tenantId = oid('0001');
const otherTenantId = oid('0002');
const actorId = oid('0003');
const masterId = oid('0010');
const variantId = oid('0020');
const now = new Date();

let mongod = null;
let mongoUri = process.env.MONGODB_URI || null;
if (!mongoUri) {
  try {
    mongod = await MongoMemoryServer.create();
    mongoUri = mongod.getUri();
  } catch (error) {
    if (error?.name === 'DownloadError' || error?.code === 'ECONNRESET') {
      console.log('durable catalog quality integration: SKIP (local mongod unavailable; CI uses MongoDB service)');
      process.exit(0);
    }
    throw error;
  }
}

try {
  await mongoose.connect(mongoUri, { dbName: 'catalog-quality-durable' });
  const db = mongoose.connection.db;
  await db.dropDatabase();
  await createQualityIndexes(db);
  await db.collection('productmasters').insertOne({
    _id: masterId, title: 'Premium Red Rose Bunch', slug: 'premium-red-rose-bunch', skuGlobal: 'ROSE-10', type: 'flower',
    status: 'active', complianceStatus: 'not_required', version: 1, isDeleted: false, createdAt: now, updatedAt: now,
  });
  await db.collection('productvariants').insertOne({
    _id: variantId, productMasterId: masterId, sku: 'ROSE-10-RED', displayLabel: 'Red', combinationKey: 'colour:red',
    isDefault: true, status: 'active', isDeleted: false, createdAt: now, updatedAt: now,
  });
  await db.collection('tenantproducts').insertOne({
    _id: oid('0030'), tenantId, productMasterId: masterId, variantId, status: 'active', stockQty: 10,
    channels: { storefront: true }, price: { sellingPrice: 299, mrp: 399 }, priceBasis: { quantity: 1, unitCode: 'bunch' },
    version: 1, isDeleted: false, createdAt: now, updatedAt: now,
  });

  const created = await catalogQualityService.createRun({ tenantId, actorId });
  assert.equal(created.status, 'queued');
  const duplicate = await catalogQualityService.createRun({ tenantId, actorId });
  assert.equal(duplicate.id, created.id, 'only one active run is allowed per tenant');
  await catalogQualityService.processAvailableRuns({ workerId: 'quality-integration', maxRuns: 1 });
  let run = await catalogQualityService.getRun(created.id, { tenantId });
  assert.equal(run.status, 'queued');
  assert.equal(run.evaluated, 1);
  await catalogQualityService.processAvailableRuns({ workerId: 'quality-integration', maxRuns: 1 });
  run = await catalogQualityService.getRun(created.id, { tenantId });
  assert.equal(run.status, 'completed');
  assert.equal(run.active, false);
  const detail = await catalogQualityService.detail({ tenantId, masterId });
  assert.equal(String(detail.qualityRunId), created.id);
  assert.match(detail.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert(detail.issues.every((finding) => finding.fingerprint && finding.firstDetectedAt && finding.lastDetectedAt));
  await assert.rejects(() => catalogQualityService.getRun(created.id, { tenantId: otherTenantId }), (error) => error.code === 'QUALITY_RUN_NOT_FOUND');

  const cancellable = await catalogQualityService.createRun({ tenantId, actorId });
  const cancelled = await catalogQualityService.cancelRun({ runId: cancellable.id, tenantId });
  assert.equal(cancelled.status, 'cancelled');

  console.log('durable catalog quality integration passed');
} finally {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}
