import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { toCSV } from '../utils/catalog/csv.js';
import tenantProductService from './tenantProduct.service.js';
import inventoryService from './inventory.service.js';
import CatalogBulkJob from '../models/catalogBulkJob.model.js';
import CatalogBulkJobRow from '../models/catalogBulkJobRow.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import { notFound, badRequest, conflict } from '../utils/ApiError.js';
import { TENANT_LISTING_STATUS } from '../constants/enums.js';

export const BULK_MAX_ROWS = 5000;
const ROW_BATCH_SIZE = 25;
const LEASE_MS = 60_000;
const MAX_JOB_ATTEMPTS = 5;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_COLUMNS = Object.freeze({
  price: ['masterId', 'listingId', 'sku', 'selling_price', 'sellingPrice', 'price', 'mrp'],
  stock: ['masterId', 'listingId', 'sku', 'qty', 'stockQty', 'quantity'],
});

function safeMessage(error) {
  return String(error?.message || error || 'Unknown row failure').slice(0, 500);
}

function publicJob(job) {
  if (!job) return null;
  const value = typeof job.toJSON === 'function' ? job.toJSON() : { ...job };
  return {
    ...value,
    id: String(value.id || value._id),
    _id: undefined,
    rows: value.totalRows,
    errors: value.errorSummary || [],
    errorSummary: undefined,
    progress: value.totalRows ? Math.round((value.processed / value.totalRows) * 100) : 0,
    claimedBy: undefined,
    leaseExpiresAt: undefined,
  };
}

function sanitizeRows(kind, rows) {
  const columns = ALLOWED_COLUMNS[kind];
  if (!columns) throw badRequest(`Unknown job kind ${kind}`, 'INVALID_JOB_KIND');
  return rows.map((row, index) => {
    const payload = {};
    for (const key of columns) {
      if (row[key] === undefined) continue;
      const value = String(row[key]).trim();
      if (value.length > 240) throw badRequest(`Row ${index + 2}, ${key} exceeds 240 characters`, 'CSV_FIELD_TOO_LONG');
      payload[key] = value;
    }
    return payload;
  });
}

class BulkImportService {
  constructor() {
    this.BULK_MAX_ROWS = BULK_MAX_ROWS;
  }

  async createJob({ kind, rows, tenantId, actorId, dryRun = false }) {
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest('CSV has no data rows', 'EMPTY_CSV');
    if (rows.length > BULK_MAX_ROWS) throw badRequest(`Too many rows: max ${BULK_MAX_ROWS} per upload`, 'CSV_TOO_LARGE');
    const safeRows = sanitizeRows(kind, rows);
    const job = await CatalogBulkJob.create({
      tenantId, kind, dryRun, totalRows: safeRows.length, requestedBy: actorId,
    });
    try {
      const documents = safeRows.map((payload, index) => ({
        jobId: job._id, tenantId, rowNumber: index + 2, payload,
      }));
      for (let start = 0; start < documents.length; start += 1000) {
        // Sequential chunks bound one insert command and preserve row order.
        // eslint-disable-next-line no-await-in-loop
        await CatalogBulkJobRow.insertMany(documents.slice(start, start + 1000), { ordered: true });
      }
    } catch (error) {
      await Promise.all([
        CatalogBulkJob.deleteOne({ _id: job._id }),
        CatalogBulkJobRow.deleteMany({ jobId: job._id }),
      ]);
      throw error;
    }
    return publicJob(job);
  }

  async getJob(id, { tenantId } = {}) {
    const query = { _id: id };
    if (tenantId) query.tenantId = tenantId;
    const job = await CatalogBulkJob.findOne(query).lean();
    if (!job) throw notFound('Bulk job not found', 'JOB_NOT_FOUND');
    return publicJob(job);
  }

  async listJobs({ tenantId, page = 1, limit = 20 } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const filter = tenantId ? { tenantId } : {};
    const [items, total] = await Promise.all([
      CatalogBulkJob.find(filter).sort({ createdAt: -1, _id: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      CatalogBulkJob.countDocuments(filter),
    ]);
    return { items: items.map(publicJob), meta: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit), hasMore: safePage * safeLimit < total } };
  }

  async listFailures({ jobId, tenantId, page = 1, limit = 50 }) {
    await this.getJob(jobId, { tenantId });
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const filter = { jobId, tenantId, status: 'failed' };
    const [items, total] = await Promise.all([
      CatalogBulkJobRow.find(filter).select('rowNumber payload errorCode errorMessage attempts finishedAt').sort({ rowNumber: 1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      CatalogBulkJobRow.countDocuments(filter),
    ]);
    return { items, meta: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit), hasMore: safePage * safeLimit < total } };
  }

  async cancelJob({ jobId, tenantId }) {
    const finishedAt = new Date();
    const expiresAt = new Date(finishedAt.getTime() + RETENTION_MS);
    let job = await CatalogBulkJob.findOneAndUpdate(
      { _id: jobId, tenantId, status: 'queued' },
      { $set: { status: 'cancelled', finishedAt, expiresAt } }, { new: true },
    );
    if (job) {
      await CatalogBulkJobRow.updateMany({ jobId: job._id }, { $set: { expiresAt } });
      return publicJob(job);
    }
    job = await CatalogBulkJob.findOneAndUpdate(
      { _id: jobId, tenantId, status: 'running' },
      { $set: { status: 'cancel_requested' } }, { new: true },
    );
    if (job) return publicJob(job);
    const existing = await CatalogBulkJob.findOne({ _id: jobId, tenantId });
    if (!existing) throw notFound('Bulk job not found', 'JOB_NOT_FOUND');
    throw conflict(`Cannot cancel a ${existing.status} job`, 'BULK_JOB_NOT_CANCELLABLE');
  }

  async retryFailures({ jobId, tenantId }) {
    const job = await CatalogBulkJob.findOne({ _id: jobId, tenantId });
    if (!job) throw notFound('Bulk job not found', 'JOB_NOT_FOUND');
    if (!['completed', 'failed'].includes(job.status) || (job.status === 'completed' && job.failed < 1)) {
      throw conflict('Only failed rows or an interrupted terminal job can be retried', 'BULK_JOB_NOT_RETRYABLE');
    }
    const retryableStatuses = job.status === 'failed' ? ['failed', 'running', 'pending'] : ['failed'];
    const reset = await CatalogBulkJobRow.updateMany(
      { jobId: job._id, tenantId, status: { $in: retryableStatuses } },
      { $set: { status: 'pending', errorCode: null, errorMessage: null, finishedAt: null, claimedBy: null, leaseExpiresAt: null, expiresAt: null } },
    );
    if (!reset.modifiedCount) throw conflict('This job has no retryable rows', 'BULK_JOB_NOT_RETRYABLE');
    job.processed = job.succeeded;
    job.failed = 0;
    job.errorSummary = [];
    job.status = 'queued';
    job.claimedBy = null;
    job.leaseExpiresAt = null;
    job.finishedAt = null;
    job.expiresAt = null;
    await job.save();
    return publicJob(job);
  }

  async claimNext(workerId) {
    const now = new Date();
    const job = await CatalogBulkJob.findOneAndUpdate(
      {
        attempts: { $lt: MAX_JOB_ATTEMPTS },
        $or: [
          { status: 'queued' },
          { status: 'running', leaseExpiresAt: { $lte: now } },
        ],
      },
      {
        $set: { status: 'running', claimedBy: workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), lastHeartbeatAt: now },
        $inc: { attempts: 1 },
      },
      { sort: { lastHeartbeatAt: 1, createdAt: 1 }, new: true },
    );
    if (job && !job.startedAt) {
      job.startedAt = now;
      await CatalogBulkJob.updateOne({ _id: job._id, startedAt: null }, { $set: { startedAt: now } });
    }
    return job;
  }

  async processAvailable({ workerId, maxJobs = 1, maxBatchesPerJob = Number.POSITIVE_INFINITY } = {}) {
    const owner = workerId || `bulk-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RETENTION_MS);
    const abandoned = await CatalogBulkJob.find({ status: 'cancel_requested', leaseExpiresAt: { $lte: now } }).select('_id');
    if (abandoned.length) {
      const ids = abandoned.map((job) => job._id);
      await Promise.all([
        CatalogBulkJob.updateMany({ _id: { $in: ids } }, { $set: { status: 'cancelled', finishedAt: now, expiresAt, claimedBy: null, leaseExpiresAt: null } }),
        CatalogBulkJobRow.updateMany({ jobId: { $in: ids } }, { $set: { expiresAt } }),
      ]);
    }
    const exhausted = await CatalogBulkJob.find({ status: 'running', attempts: { $gte: MAX_JOB_ATTEMPTS }, leaseExpiresAt: { $lte: now } }).select('_id');
    if (exhausted.length) {
      const ids = exhausted.map((job) => job._id);
      await Promise.all([
        CatalogBulkJob.updateMany({ _id: { $in: ids } }, { $set: { status: 'failed', finishedAt: now, expiresAt, claimedBy: null, leaseExpiresAt: null }, $push: { errorSummary: { row: 1, code: 'JOB_ATTEMPTS_EXHAUSTED', message: 'Worker lease expired too many times', at: now } } }),
        CatalogBulkJobRow.updateMany({ jobId: { $in: ids } }, { $set: { expiresAt } }),
      ]);
    }
    const results = [];
    for (let index = 0; index < maxJobs; index += 1) {
      // Claims must be sequential to honor maxJobs and avoid over-claiming.
      // eslint-disable-next-line no-await-in-loop
      const job = await this.claimNext(owner);
      if (!job) break;
      // A worker owns one job lease and processes ordered rows serially.
      // eslint-disable-next-line no-await-in-loop
      results.push(await this.runClaimedJob(job, owner, { maxBatches: maxBatchesPerJob }));
    }
    return results;
  }

  async runClaimedJob(job, workerId, { maxBatches = Number.POSITIVE_INFINITY } = {}) {
    let completedBatches = 0;
    while (true) {
      // Sequential status read is required so cancellation gates the next batch.
      // eslint-disable-next-line no-await-in-loop
      const current = await CatalogBulkJob.findById(job._id).select('status processed totalRows');
      if (!current) return null;
      if (current.status === 'cancel_requested') {
        return this.finishJob(job._id, 'cancelled');
      }
      // Ordered checkpoint scan must follow the latest cancellation/status read.
      // eslint-disable-next-line no-await-in-loop
      const rows = await CatalogBulkJobRow.find({
        jobId: job._id,
        $or: [{ status: 'pending' }, { status: 'running', leaseExpiresAt: { $lte: new Date() } }],
      }).sort({ rowNumber: 1 }).limit(ROW_BATCH_SIZE);
      if (!rows.length) return this.finishJob(job._id, 'completed');
      const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
      // Each bounded batch renews ownership before any row mutation begins.
      // eslint-disable-next-line no-await-in-loop
      await Promise.all([
        CatalogBulkJob.updateOne({ _id: job._id, claimedBy: workerId }, { $set: { leaseExpiresAt, lastHeartbeatAt: new Date() } }),
        CatalogBulkJobRow.updateMany({ _id: { $in: rows.map((row) => row._id) } }, { $set: { status: 'running', claimedBy: workerId, leaseExpiresAt }, $inc: { attempts: 1 } }),
      ]);
      for (const row of rows) {
        // Row order is intentional: duplicate listing rows obey CSV order.
        // eslint-disable-next-line no-await-in-loop
        await this.processRow(job, row, workerId);
      }
      completedBatches += 1;
      if (Number(current.processed) + rows.length >= Number(current.totalRows)) {
        return this.finishJob(job._id, 'completed');
      }
      if (completedBatches >= maxBatches) {
        // Cooperative yield: a bounded worker tick never monopolizes the
        // process with 5,000 rows. A normal hand-off resets crash-attempt debt.
        // eslint-disable-next-line no-await-in-loop
        const released = await CatalogBulkJob.findOneAndUpdate(
          { _id: job._id, status: 'running', claimedBy: workerId },
          { $set: { status: 'queued', claimedBy: null, leaseExpiresAt: null, attempts: 0 } },
          { new: true },
        );
        return publicJob(released);
      }
    }
  }

  async processRow(job, row, workerId) {
    try {
      if (job.kind === 'price') await this.processPriceRow(job, row.payload);
      else if (job.kind === 'stock') await this.processStockRow(job, row.payload);
      else throw badRequest(`Unknown job kind ${job.kind}`, 'INVALID_JOB_KIND');
      const finishedAt = new Date();
      await Promise.all([
        CatalogBulkJobRow.updateOne({ _id: row._id, claimedBy: workerId }, { $set: { status: 'succeeded', finishedAt, claimedBy: null, leaseExpiresAt: null } }),
        CatalogBulkJob.updateOne({ _id: job._id, claimedBy: workerId }, { $inc: { processed: 1, succeeded: 1 }, $set: { nextRow: row.rowNumber + 1, lastHeartbeatAt: finishedAt, leaseExpiresAt: new Date(Date.now() + LEASE_MS) } }),
      ]);
    } catch (error) {
      const finishedAt = new Date();
      const detail = { row: row.rowNumber, code: error?.code || null, message: safeMessage(error), at: finishedAt };
      await Promise.all([
        CatalogBulkJobRow.updateOne({ _id: row._id, claimedBy: workerId }, { $set: { status: 'failed', errorCode: detail.code, errorMessage: detail.message, finishedAt, claimedBy: null, leaseExpiresAt: null } }),
        CatalogBulkJob.updateOne(
          { _id: job._id, claimedBy: workerId },
          { $inc: { processed: 1, failed: 1 }, $set: { nextRow: row.rowNumber + 1, lastHeartbeatAt: finishedAt, leaseExpiresAt: new Date(Date.now() + LEASE_MS) }, $push: { errorSummary: { $each: [detail], $slice: -100 } } },
        ),
      ]);
    }
  }

  async finishJob(jobId, status) {
    const finishedAt = new Date();
    const expiresAt = new Date(finishedAt.getTime() + RETENTION_MS);
    const counts = await CatalogBulkJobRow.aggregate([
      { $match: { jobId: new mongoose.Types.ObjectId(jobId), status: { $in: ['succeeded', 'failed'] } } },
      { $group: { _id: '$status', count: { $sum: 1 }, maxRow: { $max: '$rowNumber' } } },
    ]);
    const succeeded = counts.find((row) => row._id === 'succeeded')?.count || 0;
    const failed = counts.find((row) => row._id === 'failed')?.count || 0;
    const processed = succeeded + failed;
    const maxRow = Math.max(1, ...counts.map((row) => row.maxRow || 1));
    const job = await CatalogBulkJob.findOneAndUpdate(
      { _id: jobId, status: { $in: ['running', 'cancel_requested'] } },
      { $set: { status, processed, succeeded, failed, nextRow: maxRow + 1, finishedAt, expiresAt, claimedBy: null, leaseExpiresAt: null } }, { new: true },
    );
    await CatalogBulkJobRow.updateMany({ jobId }, { $set: { expiresAt } });
    return publicJob(job);
  }

  async processPriceRow(job, row) {
    const { listing, masterId } = await this.findListing(job.tenantId, row);
    const price = this.parsePrice(row);
    if (job.dryRun) return;
    if (listing) {
      await tenantProductService.updatePrice({
        tenantId: job.tenantId, listingId: listing.id, price,
        expectedVersion: listing.version, actorId: job.requestedBy, reason: 'bulk', source: 'tenant',
      });
    } else if (masterId) {
      await tenantProductService.createListing({
        tenantId: job.tenantId,
        payload: { productMasterId: masterId, variantId: null, price, status: TENANT_LISTING_STATUS.ACTIVE, stockQty: 0 },
        actorId: job.requestedBy,
      });
    } else {
      throw badRequest(`No listing or master for ${row.listingId || row.sku || row.masterId || 'row'}`, 'LISTING_NOT_FOUND');
    }
  }

  async processStockRow(job, row) {
    const { listing } = await this.findListing(job.tenantId, row);
    if (!listing) throw notFound(`No listing for ${row.listingId || row.sku || row.masterId || 'row'}`, 'LISTING_NOT_FOUND');
    const qty = Number(row.qty ?? row.stockQty ?? row.quantity);
    if (!Number.isInteger(qty) || qty < 0) throw badRequest('Invalid quantity', 'INVALID_QTY');
    if (job.dryRun) return;
    await inventoryService.setStock({ tenantId: job.tenantId, listingId: listing.id, qty, actorId: job.requestedBy });
  }

  async findListing(tenantId, row) {
    const query = { tenantId, isDeleted: { $ne: true } };
    if (row.listingId) {
      if (!mongoose.isValidObjectId(row.listingId)) throw badRequest('Invalid listingId', 'INVALID_LISTING_ID');
      const listing = await TenantProduct.findOne({ ...query, _id: row.listingId });
      return { listing, masterId: listing?.productMasterId || null };
    }
    let masterId = row.masterId || null;
    if (masterId && !mongoose.isValidObjectId(masterId)) throw badRequest('Invalid masterId', 'INVALID_MASTER_ID');
    if (row.sku) {
      const master = await ProductMaster.findOne({ skuGlobal: row.sku, isDeleted: { $ne: true } }).select('_id');
      if (master) masterId = master._id;
    }
    if (!masterId) return { listing: null, masterId: null };
    const listing = await TenantProduct.findOne({ ...query, productMasterId: masterId }).sort({ variantId: 1, createdAt: 1 });
    return { listing, masterId };
  }

  parsePrice(row) {
    const sellingPrice = Number(row.selling_price ?? row.price ?? row.sellingPrice);
    const mrp = row.mrp === '' || row.mrp === undefined ? null : Number(row.mrp);
    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) throw badRequest(`Invalid selling price: ${row.selling_price ?? row.price}`, 'PRICE_INVALID');
    if (mrp !== null && (!Number.isFinite(mrp) || mrp < sellingPrice)) throw badRequest('MRP must be >= selling price', 'PRICE_INVALID');
    return { mrp, sellingPrice, currency: 'INR' };
  }

  priceTemplate() { return toCSV([], ['masterId', 'listingId', 'sku', 'price', 'mrp']); }
  stockTemplate() { return toCSV([], ['masterId', 'listingId', 'sku', 'qty']); }
}

export default new BulkImportService();
