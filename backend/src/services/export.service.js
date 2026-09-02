/**
 * ExportService — scheduled CSV/BI reports (Phase 4b blueprint §3-5).
 *
 * Idempotent on jobKey so nightly creation is a safe upsert. runJob renders
 * via the Phase-4 admin csv() functions (never re-implements CSV), stores the
 * artifact (BOM-prefixed CSV) in Mongo, and marks done. Failures are retried
 * by re-running the worker (attempts + lastError are recorded).
 */

import ExportJob from '../models/exportJob.model.js';
import ExportArtifact from '../models/exportArtifact.model.js';
import { toCsvString } from '../utils/csv.js';
import { serializeList } from '../utils/serialize.js';
import { notFound, badRequest } from '../utils/ApiError.js';
import adminCatalogService from './adminCatalog.service.js';
import adminInventoryService from './adminInventory.service.js';
import adminOrdersService from './adminOrders.service.js';
import adminUsersService from './adminUsers.service.js';
import analyticsService from './analytics.service.js';
import config from '../config/index.js';
import { EXPORT_JOB_TYPE, EXPORT_JOB_STATUS } from '../constants/enums.js';

const TYPE_DEFS = {
  [EXPORT_JOB_TYPE.ANALYTICS_DAILY]: {
    label: 'analytics',
    filename: 'analytics.csv',
    headers: [['date', 'Date'], ['hubId', 'Hub'], ['ordersCreated', 'Orders'], ['gmv', 'GMV'], ['netRevenue', 'Net Revenue'], ['aov', 'AOV'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['returnRequests', 'Returns'], ['newCustomers', 'New Customers'], ['repeatCustomers', 'Repeat Customers']],
    render: ({ tenantId, params }) => analyticsService.csv({ tenantId, from: params.from, to: params.to, hubId: params.hubId || null }),
  },
  [EXPORT_JOB_TYPE.ORDERS]: {
    label: 'orders',
    filename: 'orders.csv',
    headers: [['orderNumber', 'Order'], ['status', 'Status'], ['createdAt', 'Created'], ['customerName', 'Customer'], ['itemsCount', 'Items'], ['itemsSubtotal', 'Subtotal'], ['deliveryFee', 'Delivery Fee'], ['discount', 'Discount'], ['taxAmount', 'Tax'], ['totalAmount', 'Total'], ['paymentMethod', 'Payment'], ['pincode', 'Pincode'], ['hubId', 'Hub'], ['slot', 'Slot']],
    render: ({ tenantId, params }) => adminOrdersService.csv({ tenantId, query: params.query || {} }),
  },
  [EXPORT_JOB_TYPE.INVENTORY]: {
    label: 'inventory',
    filename: 'inventory.csv',
    headers: [['listingId', 'Listing ID'], ['skuGlobal', 'SKU'], ['title', 'Title'], ['mrp', 'MRP'], ['sellingPrice', 'Selling Price'], ['qtyOnHand', 'Qty On Hand'], ['qtyReserved', 'Qty Reserved'], ['available', 'Available'], ['health', 'Health'], ['restockSuggestion', 'Restock Suggestion']],
    render: ({ tenantId, params }) => adminInventoryService.csv({ tenantId, query: params.query || {} }),
  },
  [EXPORT_JOB_TYPE.PRODUCTS]: {
    label: 'products',
    filename: 'products.csv',
    headers: [['id', 'ID'], ['skuGlobal', 'SKU'], ['title', 'Title'], ['type', 'Type'], ['categoryId', 'Category ID'], ['status', 'Status'], ['mrp', 'MRP'], ['sellingPrice', 'Selling Price'], ['qtyOnHand', 'Qty On Hand'], ['qtyReserved', 'Qty Reserved'], ['available', 'Available'], ['health', 'Health']],
    render: ({ tenantId, params }) => adminCatalogService.csv({ tenantId, query: params.query || {} }),
  },
  [EXPORT_JOB_TYPE.USERS]: {
    label: 'users',
    filename: 'users.csv',
    headers: [['id', 'ID'], ['role', 'Role'], ['status', 'Status'], ['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['createdAt', 'Created']],
    render: ({ tenantId, params }) => adminUsersService.csv({ tenantId, query: params.query || {} }),
  },
};

/** {type}:{from}:{to}(:{hubId}) — unique per job, drives idempotency. */
export function buildJobKey({ type, params = {} }) {
  const parts = [type];
  if (params.from || params.to) parts.push(params.from || 'all', params.to || 'all');
  if (params.hubId) parts.push(params.hubId);
  return parts.join(':');
}

class ExportService {
  async createJob({ tenantId, type, params = {}, scheduledFor = null, requestedBy = null, req = null }) {
    if (!TYPE_DEFS[type]) throw badRequest(`Unsupported export type: ${type}`, 'BAD_EXPORT_TYPE');
    const jobKey = buildJobKey({ type, params });
    const existing = await ExportJob.findOne({ tenantId, jobKey });
    if (existing) return { job: existing, created: false }; // idempotent
    const job = await ExportJob.create({
      tenantId,
      jobKey,
      type,
      params: params || {},
      status: EXPORT_JOB_STATUS.PENDING,
      scheduledFor: scheduledFor || null,
      requestedBy: requestedBy || null,
    });
    return { job, created: true };
  }

  /** Render one job → artifact. Idempotent-ish: re-running overwrites. */
  async runJob(jobIdOrJob) {
    const job = jobIdOrJob && typeof jobIdOrJob.save === 'function'
      ? jobIdOrJob
      : await ExportJob.findById(jobIdOrJob);
    if (!job) throw notFound('Export job not found', 'EXPORT_JOB_NOT_FOUND');

    const def = TYPE_DEFS[job.type];
    if (!def) {
      job.status = EXPORT_JOB_STATUS.FAILED;
      job.lastError = `Unsupported export type: ${job.type}`;
      job.attempts = (job.attempts || 0) + 1;
      await job.save();
      return job;
    }

    job.status = EXPORT_JOB_STATUS.RUNNING;
    job.attempts = (job.attempts || 0) + 1;
    await job.save();

    try {
      const rows = await def.render({ tenantId: job.tenantId, params: job.params || {} });
      const csv = toCsvString(rows, def.headers);
      const artifact = await ExportArtifact.create({
        tenantId: job.tenantId,
        type: job.type,
        params: job.params || {},
        csv,
        rowCount: rows.length,
        sizeBytes: Buffer.byteLength(csv, 'utf8'),
        requestedBy: job.requestedBy || null,
        completedAt: new Date(),
      });
      job.status = EXPORT_JOB_STATUS.DONE;
      job.artifactId = artifact._id;
      job.lastError = null;
      job.completedAt = new Date();
      job.scheduledFor = null;
      await job.save();
      return { job, artifact };
    } catch (err) {
      job.status = EXPORT_JOB_STATUS.FAILED;
      job.lastError = err?.message || String(err);
      await job.save();
      return { job, artifact: null };
    }
  }

  /** Worker: run all due pending jobs (scheduledFor null/<= now). */
  async runDueJobs({ limit = 20 } = {}) {
    const jobs = await ExportJob.find({
      status: EXPORT_JOB_STATUS.PENDING,
      $or: [{ scheduledFor: null }, { scheduledFor: { $lte: new Date() } }],
    })
      .sort({ createdAt: 1 })
      .limit(Math.min(limit, 50));
    const results = [];
    for (const job of jobs) {
      results.push(await this.runJob(job));
    }
    return { scanned: jobs.length, done: results.filter((r) => r.job.status === EXPORT_JOB_STATUS.DONE).length, failed: results.filter((r) => r.job.status === EXPORT_JOB_STATUS.FAILED).length };
  }

  // ---------------- admin read side ----------------
  async list({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = { tenantId };
    if (query.status) q.status = query.status;
    if (query.type) q.type = query.type;
    const [docs, total] = await Promise.all([
      ExportJob.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ExportJob.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async detail({ tenantId, jobId }) {
    const job = await ExportJob.findOne({ _id: jobId, tenantId }).lean();
    if (!job) throw notFound('Export job not found', 'EXPORT_JOB_NOT_FOUND');
    let artifact = null;
    if (job.artifactId) {
      const a = await ExportArtifact.findOne({ _id: job.artifactId, tenantId }).lean();
      if (a) artifact = { id: a._id, type: a.type, rowCount: a.rowCount, sizeBytes: a.sizeBytes, completedAt: a.completedAt };
    }
    return { ...job, id: job._id, artifact };
  }

  async artifactForDownload({ tenantId, jobId }) {
    const job = await ExportJob.findOne({ _id: jobId, tenantId }).lean();
    if (!job) throw notFound('Export job not found', 'EXPORT_JOB_NOT_FOUND');
    if (job.status !== EXPORT_JOB_STATUS.DONE || !job.artifactId) throw badRequest('Export job has no artifact yet', 'EXPORT_NOT_READY');
    const artifact = await ExportArtifact.findOne({ _id: job.artifactId, tenantId });
    if (!artifact) throw notFound('Export artifact not found', 'ARTIFACT_NOT_FOUND');
    const def = TYPE_DEFS[job.type] || {};
    return { csv: artifact.csv, filename: def.filename || `${job.type}.csv` };
  }
}

export default new ExportService();
