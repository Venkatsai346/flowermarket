import assert from 'node:assert/strict';
import bulkImportService, { BULK_MAX_ROWS } from '../src/services/bulkImport.service.js';
import CatalogBulkJob from '../src/models/catalogBulkJob.model.js';
import CatalogBulkJobRow from '../src/models/catalogBulkJobRow.model.js';
import TenantProduct from '../src/models/tenantProduct.model.js';
import ProductMaster from '../src/models/productMaster.model.js';
import { bulkQuerySchema, bulkUploadSchema, bulkJobParamSchema } from '../src/utils/validators/catalog.validators.js';

const tenantId = '66a000000000000000000001';
const actorId = '66a000000000000000000002';
const jobId = '66a000000000000000000003';
const listingId = '66a000000000000000000004';
const masterId = '66a000000000000000000005';

assert.equal(BULK_MAX_ROWS, 5000);
assert.equal(bulkImportService.BULK_MAX_ROWS, 5000, 'controller limit is exposed by the service instance');
assert.equal(bulkQuerySchema.validate({ dryRun: 'true' }).value.dryRun, true);
assert.equal(bulkUploadSchema.validate({ csv: 'sku,price\nABC,20' }).error, undefined);
assert.ok(bulkUploadSchema.validate({}).error);
assert.equal(bulkJobParamSchema.validate({ jobId }).error, undefined);
assert.ok(bulkJobParamSchema.validate({ jobId: 'job_timestamp' }).error, 'durable IDs are Mongo object IDs');

const jobStatuses = CatalogBulkJob.schema.path('status').enumValues;
assert.deepEqual(jobStatuses, ['queued', 'running', 'cancel_requested', 'cancelled', 'completed', 'failed']);
assert.ok(CatalogBulkJob.schema.indexes().some(([keys]) => keys.status === 1 && keys.leaseExpiresAt === 1));
assert.ok(CatalogBulkJob.schema.indexes().some(([keys]) => keys.status === 1 && keys.lastHeartbeatAt === 1), 'fair queue index exists');
assert.ok(CatalogBulkJobRow.schema.indexes().some(([keys, opts]) => keys.jobId === 1 && keys.rowNumber === 1 && opts.unique));

const originals = {
  create: CatalogBulkJob.create,
  deleteJob: CatalogBulkJob.deleteOne,
  insertRows: CatalogBulkJobRow.insertMany,
  deleteRows: CatalogBulkJobRow.deleteMany,
  listingFind: TenantProduct.findOne,
  masterFind: ProductMaster.findOne,
};

try {
  let inserted = [];
  CatalogBulkJob.create = async (payload) => ({
    _id: jobId, id: jobId, ...payload, status: 'queued', processed: 0, succeeded: 0, failed: 0,
    toJSON() { return { id: jobId, ...payload, status: 'queued', processed: 0, succeeded: 0, failed: 0 }; },
  });
  CatalogBulkJobRow.insertMany = async (rows) => { inserted.push(...rows); return rows; };
  CatalogBulkJob.deleteOne = async () => ({ deletedCount: 1 });
  CatalogBulkJobRow.deleteMany = async () => ({ deletedCount: 0 });

  const job = await bulkImportService.createJob({
    kind: 'price', tenantId, actorId, dryRun: true,
    rows: [{ sku: ' ROSE-10 ', price: '299', ignored: 'must-not-persist' }],
  });
  assert.equal(job.status, 'queued');
  assert.equal(job.rows, 1);
  assert.equal(inserted.length, 1);
  assert.deepEqual(inserted[0].payload, { sku: 'ROSE-10', price: '299' }, 'only allowlisted, trimmed fields persist');
  assert.equal(inserted[0].rowNumber, 2);

  let listingQuery;
  TenantProduct.findOne = async (query) => { listingQuery = query; return { _id: listingId, id: listingId, productMasterId: masterId }; };
  const byId = await bulkImportService.findListing(tenantId, { listingId });
  assert.equal(String(byId.listing._id), listingId);
  assert.equal(listingQuery._id, listingId, 'listingId targets the requested listing rather than an arbitrary tenant row');
  assert.equal(String(listingQuery.tenantId), tenantId);

  let masterQuery;
  let tenantMasterQuery;
  ProductMaster.findOne = (query) => { masterQuery = query; return { select: async () => ({ _id: masterId }) }; };
  TenantProduct.findOne = (query) => { tenantMasterQuery = query; return { sort: async () => null }; };
  const bySku = await bulkImportService.findListing(tenantId, { sku: 'ROSE-10' });
  assert.equal(String(bySku.masterId), masterId);
  assert.equal(masterQuery.skuGlobal, 'ROSE-10');
  assert.equal(String(tenantMasterQuery.productMasterId), masterId);

  assert.deepEqual(bulkImportService.parsePrice({ price: '299', mrp: '399' }), { sellingPrice: 299, mrp: 399, currency: 'INR' });
  assert.throws(() => bulkImportService.parsePrice({ price: '400', mrp: '399' }), /MRP/);
} finally {
  CatalogBulkJob.create = originals.create;
  CatalogBulkJob.deleteOne = originals.deleteJob;
  CatalogBulkJobRow.insertMany = originals.insertRows;
  CatalogBulkJobRow.deleteMany = originals.deleteRows;
  TenantProduct.findOne = originals.listingFind;
  ProductMaster.findOne = originals.masterFind;
}

console.log('durable catalog bulk tests passed');
