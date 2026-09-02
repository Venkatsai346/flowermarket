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
import gstrExportService from './gstrExport.service.js';
import payoutService from './payout.service.js';
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

  // ---- Phase 6.2/M3: GST filing working papers -------------------------
  // Each renderer returns plain rows; the machinery above (idempotent jobKey,
  // worker, artifact store, download route) is reused unchanged.
  [EXPORT_JOB_TYPE.GSTR1_B2B]: {
    label: 'gstr1-b2b',
    filename: 'gstr1-b2b.csv',
    headers: [['recipientGstin', 'GSTIN/UIN of Recipient'], ['recipientName', 'Receiver Name'], ['invoiceNumber', 'Invoice Number'], ['invoiceDate', 'Invoice date'], ['invoiceValue', 'Invoice Value'], ['placeOfSupply', 'Place Of Supply'], ['reverseCharge', 'Reverse Charge'], ['invoiceType', 'Invoice Type'], ['ecommerceGstin', 'E-Commerce GSTIN'], ['rate', 'Rate'], ['taxableValue', 'Taxable Value'], ['cessAmount', 'Cess Amount'], ['irn', 'IRN']],
    render: ({ tenantId, params }) => gstrExportService.gstr1B2b({ tenantId, from: params.from, to: params.to }),
  },
  [EXPORT_JOB_TYPE.GSTR1_B2CS]: {
    label: 'gstr1-b2cs',
    filename: 'gstr1-b2cs.csv',
    headers: [['type', 'Type'], ['placeOfSupply', 'Place Of Supply'], ['rate', 'Rate'], ['taxableValue', 'Taxable Value'], ['cessAmount', 'Cess Amount'], ['cgst', 'Central Tax'], ['sgst', 'State/UT Tax'], ['igst', 'Integrated Tax'], ['invoices', 'Invoice Count']],
    render: ({ tenantId, params }) => gstrExportService.gstr1B2cs({ tenantId, from: params.from, to: params.to }),
  },
  [EXPORT_JOB_TYPE.GSTR1_HSN]: {
    label: 'gstr1-hsn',
    filename: 'gstr1-hsn.csv',
    headers: [['hsn', 'HSN'], ['description', 'Description'], ['uqc', 'UQC'], ['rate', 'Rate'], ['natureOfSupply', 'Nature of Supply'], ['totalQuantity', 'Total Quantity'], ['totalValue', 'Total Value'], ['taxableValue', 'Taxable Value'], ['integratedTax', 'Integrated Tax Amount'], ['centralTax', 'Central Tax Amount'], ['stateTax', 'State/UT Tax Amount'], ['cess', 'Cess Amount']],
    render: ({ tenantId, params }) => gstrExportService.gstr1Hsn({ tenantId, from: params.from, to: params.to }),
  },
  [EXPORT_JOB_TYPE.GSTR1_CDNR]: {
    label: 'gstr1-cdnr',
    filename: 'gstr1-cdnr.csv',
    headers: [['recipientGstin', 'GSTIN/UIN of Recipient'], ['recipientName', 'Receiver Name'], ['noteNumber', 'Note Number'], ['noteDate', 'Note Date'], ['noteType', 'Note Type'], ['originalInvoiceNumber', 'Invoice/Advance Receipt Number'], ['placeOfSupply', 'Place Of Supply'], ['reverseCharge', 'Reverse Charge'], ['noteValue', 'Note Value'], ['rate', 'Rate'], ['taxableValue', 'Taxable Value'], ['cessAmount', 'Cess Amount'], ['reason', 'Reason']],
    render: ({ tenantId, params }) => gstrExportService.gstr1Cdnr({ tenantId, from: params.from, to: params.to }),
  },
  [EXPORT_JOB_TYPE.GSTR8_TCS]: {
    label: 'gstr8-tcs',
    filename: 'gstr8-tcs.csv',
    headers: [['supplierGstin', 'GSTIN of Supplier'], ['supplierName', 'Supplier Name'], ['grossValueOfSupplies', 'Gross Value of Supplies'], ['valueOfSuppliesReturned', 'Value of Supplies Returned'], ['netAmountLiableToTcs', 'Net Amount Liable to TCS'], ['tcsRatePct', 'TCS Rate %'], ['integratedTaxTcs', 'Integrated Tax'], ['centralTaxTcs', 'Central Tax'], ['stateTaxTcs', 'State/UT Tax'], ['totalTcs', 'Total TCS'], ['rateNotification', 'Rate Source']],
    render: ({ tenantId, params }) => gstrExportService.gstr8Tcs({ tenantId, from: params.from, to: params.to }),
  },
  [EXPORT_JOB_TYPE.TDS_194O]: {
    label: 'tds-194o',
    filename: 'tds-194o.csv',
    headers: [['deducteeName', 'Deductee Name'], ['deducteeGstin', 'Deductee GSTIN'], ['deducteePan', 'Deductee PAN'], ['invoiceCount', 'Invoices'], ['grossAmountPaid', 'Gross Amount'], ['tdsRatePct', 'TDS Rate %'], ['tdsAmount', 'TDS Amount'], ['section', 'Section'], ['rateNotification', 'Rate Source']],
    render: ({ tenantId, params }) => gstrExportService.tds194o({ tenantId, from: params.from, to: params.to }),
  },
  // ---- Phase 6.3/M5: the vendor's line-item payout statement ----
  // Vendors dispute payouts constantly; a per-line statement is the difference
  // between a support ticket and a self-serve answer.
  [EXPORT_JOB_TYPE.PAYOUT_STATEMENT]: {
    label: 'payout-statement',
    filename: 'payout-statement.csv',
    headers: [['orderNumber', 'Order'], ['gross', 'Gross'], ['taxableValue', 'Taxable Value'], ['sellerGst', 'Your GST'], ['commissionRatePct', 'Commission %'], ['commission', 'Commission'], ['gstOnCommission', 'GST on Commission'], ['tcs', 'TCS'], ['tds', 'TDS'], ['netPayable', 'Net Payable'], ['isReversal', 'Reversal']],
    render: async ({ params }) => {
      const stmt = await payoutService.statement({ batchId: params.batchId });
      return stmt.lines;
    },
  },
  [EXPORT_JOB_TYPE.SALES_REGISTER]: {
    label: 'sales-register',
    filename: 'sales-register.csv',
    headers: [['docType', 'Document Type'], ['number', 'Number'], ['date', 'Date'], ['orderNumber', 'Order'], ['originalNumber', 'Original Document'], ['supplierName', 'Supplier'], ['supplierGstin', 'Supplier GSTIN'], ['recipientName', 'Recipient'], ['recipientGstin', 'Recipient GSTIN'], ['placeOfSupply', 'Place Of Supply'], ['taxableValue', 'Taxable Value'], ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'], ['cess', 'Cess'], ['roundOff', 'Round Off'], ['total', 'Total'], ['irn', 'IRN'], ['status', 'Status']],
    render: ({ tenantId, params }) => gstrExportService.salesRegister({ tenantId, from: params.from, to: params.to }),
  },
};

/** {type}:{from}:{to}(:{hubId}) — unique per job, drives idempotency. */
export function buildJobKey({ type, params = {} }) {
  const parts = [type];
  if (params.from || params.to) parts.push(params.from || 'all', params.to || 'all');
  if (params.hubId) parts.push(params.hubId);
  if (params.batchId) parts.push(String(params.batchId)); // payout statements
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
