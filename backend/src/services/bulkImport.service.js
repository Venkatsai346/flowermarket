import { toCSV } from '../utils/catalog/csv.js';
import tenantProductService from './tenantProduct.service.js';
import inventoryService from './inventory.service.js';
import { notFound, badRequest } from '../utils/ApiError.js';
import { TENANT_LISTING_STATUS } from '../constants/enums.js';
import { BoundedCache } from '../utils/BoundedCache.js';

/**
 * BulkImportService — CSV price/stock uploads for a tenant.
 *
 * Implementation notes:
 *  - In-process bounded job registry (BoundedCache, max 100 jobs, 1hr TTL).
 *    A real deployment would back this with a queue (BullMQ/Redis) + worker;
 *    the API contract stays the same: POST creates a job, GET /:jobId polls.
 *  - dryRun validates every row and reports errors WITHOUT writing.
 *  - Price rows create/activate listings; stock rows set inventory.
 */
const jobs = new BoundedCache({ maxEntries: 100, ttlMs: 60 * 60 * 1000, name: 'bulk-import:jobs' });
let jobCounter = 0;

/** Hard cap per upload — bounds worst-case sequential processing time. */
export const BULK_MAX_ROWS = 5000;

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
    const all = [];
    for (const job of jobs.values()) {
      if (!tenantId || String(job.tenantId) === String(tenantId)) {
        all.push(job);
      }
    }
    return all.slice(-50).reverse();
  }

  // ---------------- row processors ----------------

  async processPriceRows(job, { dryRun }) {
    const { rows, tenantId, actorId } = job;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      job.processed = i + 1;
      try {
        const { listing, masterId } = await this.findListing(tenantId, row);
        const price = this.parsePrice(row);
        if (dryRun) { job.succeeded += 1; continue; }
        if (listing) {
          await tenantProductService.updatePrice({
            tenantId, listingId: listing.id, price,
            expectedVersion: listing.version, actorId, reason: 'bulk', source: 'tenant',
          });
        } else if (masterId) {
          // Resolve the REAL master id (a SKU-keyed row has no masterId
          // column — the old `row.masterId || null` created with null → 404).
          await tenantProductService.createListing({
            tenantId,
            payload: { productMasterId: masterId, variantId: null, price, status: TENANT_LISTING_STATUS.ACTIVE, stockQty: 0 },
            actorId,
          });
        } else {
          throw badRequest(`No listing and no resolvable master for ${row.listingId || row.sku || row.masterId || 'row'}`, 'LISTING_NOT_FOUND');
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

  /**
   * Resolve the tenant listing a CSV row targets.
   * @returns {Promise<{ listing: object|null, masterId: object|null }>}
   *
   * Deterministic targeting: when a row keys by master (masterId or sku) and
   * the tenant lists MULTIPLE variants of that master, the MASTER-LEVEL row
   * (variantId == null) wins, then the oldest listing. (The old unsorted
   * findOne hit an arbitrary variant row — a bulk price "update" could land
   * on the wrong SKU.)
   */
  async findListing(tenantId, row) {
    const TenantProduct = (await import('../models/tenantProduct.model.js')).default;
    const q = { tenantId };
    if (row.listingId) {
      const listing = await TenantProduct.findOne(q);
      return { listing, masterId: listing?.productMasterId || null };
    }
    let masterId = row.masterId || null;
    if (row.sku) {
      const ProductMaster = (await import('../models/productMaster.model.js')).default;
      const master = await ProductMaster.findOne({ skuGlobal: row.sku });
      if (master) masterId = master._id;
    }
    if (masterId) {
      q.productMasterId = masterId;
      // variantId null sorts first in Mongo, then oldest first — deterministic.
      const listing = await TenantProduct.findOne(q).sort({ variantId: 1, createdAt: 1 });
      return { listing, masterId };
    }
    return { listing: null, masterId: null };
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
