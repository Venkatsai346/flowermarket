import { parseCSV, toCSV } from '../utils/catalog/csv.js';
import tenantProductService from './tenantProduct.service.js';
import inventoryService from './inventory.service.js';
import auditService from './audit.service.js';
import { notFound, badRequest } from '../utils/ApiError.js';
import { TENANT_LISTING_STATUS } from '../constants/enums.js';

/**
 * BulkImportService — CSV price/stock uploads for a tenant.
 *
 * Implementation notes:
 *  - In-process async job registry (Map). A real deployment would back this
 *    with a queue (BullMQ/Redis) + worker; the API contract stays the same:
 *    POST creates a job, GET /:jobId polls status.
 *  - dryRun validates every row and reports errors WITHOUT writing.
 *  - Price rows create/activate listings; stock rows set inventory.
 */
const jobs = new Map();
let jobCounter = 0;

class BulkImportService {
  createJob({ kind, rows, tenantId, actorId }) {
    jobCounter += 1;
    const job = {
      id: `job_${Date.now()}_${jobCounter}`,
      kind, // 'price' | 'stock'
      tenantId,
      actorId,
      rows: rows.length,
      status: 'queued',
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      startedAt: null,
      finishedAt: null,
    };
    jobs.set(job.id, job);
    return job;
  }

  async runJob(job, { dryRun = false } = {}) {
    job.status = 'running';
    job.startedAt = new Date();
    try {
      if (job.kind === 'price') await this.processPriceRows(job, { dryRun });
      else if (job.kind === 'stock') await this.processStockRows(job, { dryRun });
      else throw badRequest(`Unknown job kind ${job.kind}`, 'INVALID_JOB_KIND');
      job.status = 'completed';
    } catch (err) {
      job.status = 'failed';
      job.failed += 1;
      job.errors.push({ row: 0, message: err?.message || String(err) });
    }
    job.finishedAt = new Date();
    return job;
  }

  getJob(id) {
    const job = jobs.get(id);
    if (!job) throw notFound('Job not found', 'JOB_NOT_FOUND');
    return job;
  }

  listJobs({ tenantId } = {}) {
    return [...jobs.values()].filter((j) => !tenantId || String(j.tenantId) === String(tenantId)).slice(-50).reverse();
  }

  // ---------------- row processors ----------------

  async processPriceRows(job, { dryRun }) {
    const { rows, tenantId, actorId } = job;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      job.processed = i + 1;
      try {
        const listing = await this.findListing(tenantId, row);
        const price = this.parsePrice(row);
        if (dryRun) { job.succeeded += 1; continue; }
        if (listing) {
          await tenantProductService.updatePrice({
            tenantId, listingId: listing.id, price,
            expectedVersion: listing.version, actorId, reason: 'bulk', source: 'tenant',
          });
        } else {
          await tenantProductService.createListing({
            tenantId,
            payload: { productMasterId: row.masterId || null, variantId: null, price, status: TENANT_LISTING_STATUS.ACTIVE, stockQty: 0 },
            actorId,
          });
        }
        job.succeeded += 1;
      } catch (err) {
        job.failed += 1;
        job.errors.push({ row: i + 2, message: err?.message || String(err) }); // +2: header offset
      }
    }
  }

  async processStockRows(job, { dryRun }) {
    const { rows, tenantId, actorId } = job;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      job.processed = i + 1;
      try {
        const listing = await this.findListing(tenantId, row);
        if (!listing) throw notFound(`No active listing for ${row.listingId || row.sku || row.masterId}`, 'LISTING_NOT_FOUND');
        const qty = Number(row.qty ?? row.stockQty ?? row.quantity);
        if (!Number.isInteger(qty) || qty < 0) throw badRequest('Invalid quantity', 'INVALID_QTY');
        if (dryRun) { job.succeeded += 1; continue; }
        await inventoryService.setStock({ tenantId, listingId: listing.id, qty, actorId });
        job.succeeded += 1;
      } catch (err) {
        job.failed += 1;
        job.errors.push({ row: i + 2, message: err?.message || String(err) });
      }
    }
  }

  // ---------------- helpers ----------------

  async findListing(tenantId, row) {
    const TenantProduct = (await import('../models/tenantProduct.model.js')).default;
    const q = { tenantId };
    if (row.listingId) {
      q._id = row.listingId;
      return TenantProduct.findOne(q);
    }
    if (row.masterId) {
      q.productMasterId = row.masterId;
      return TenantProduct.findOne(q);
    }
    if (row.sku) {
      const ProductMaster = (await import('../models/productMaster.model.js')).default;
      const master = await ProductMaster.findOne({ skuGlobal: row.sku });
      if (master) {
        q.productMasterId = master._id;
        return TenantProduct.findOne(q);
      }
    }
    return null;
  }

  parsePrice(row) {
    const sellingPrice = Number(row.selling_price ?? row.price ?? row.sellingPrice);
    const mrp = row.mrp === '' || row.mrp === undefined ? null : Number(row.mrp);
    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
      throw badRequest(`Invalid selling price: ${row.selling_price ?? row.price}`, 'PRICE_INVALID');
    }
    if (mrp !== null && (!Number.isFinite(mrp) || mrp < sellingPrice)) {
      throw badRequest('MRP must be >= selling price', 'PRICE_INVALID');
    }
    return { mrp, sellingPrice, currency: 'INR' };
  }

  /** Template CSV for download. */
  priceTemplate() {
    return toCSV([], ['masterId', 'listingId', 'sku', 'price', 'mrp']);
  }

  stockTemplate() {
    return toCSV([], ['masterId', 'listingId', 'sku', 'qty']);
  }
}

export default new BulkImportService();
