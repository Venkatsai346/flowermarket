import productMasterService from '../services/productMaster.service.js';
import tenantProductService from '../services/tenantProduct.service.js';
import changeRequestService from '../services/changeRequest.service.js';
import inventoryService from '../services/inventory.service.js';
import bulkImportService from '../services/bulkImport.service.js';
import catalogQualityService from '../services/catalogQuality.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';
import { badRequest } from '../utils/ApiError.js';
import { catalogIdempotencyKey } from '../services/catalogCommand.service.js';

/**
 * CatalogTenantController — tenant-portal endpoints.
 * The tenant manages its own listings (price/stock/status), proposes new
 * masters, submits global-field change requests, and runs bulk imports.
 */
class CatalogTenantController {
  // ---------------- propose new global SKU (goes to review) ----------------
  proposeMaster = asyncHandler(async (req, res) => {
    const result = await productMasterService.proposeMaster({
      payload: req.body, tenantId: req.tenantId, actorId: req.auth.userId, req,
    });
    res.status(201).json(created(result, { message: 'Master proposed for review' }));
  });

  // ---------------- listings ----------------
  /**
   * Read-only discovery of ACTIVE global masters for listing creation.
   * Tenant admins cannot call /catalog/admin/masters (correctly SUPER_ADMIN
   * only), so the console needs this tenant-authorized registry search. A
   * compliance-pending master may be staged as a draft; activation remains
   * guarded by catalogStructureService.assertPublishable().
   */
  listAvailableMasters = asyncHandler(async (req, res) => {
    const result = await productMasterService.listMasters({
      query: { ...req.query, status: 'active' },
    });
    res.status(200).json(success(result.items, {
      message: 'Available product masters fetched', meta: result.meta,
    }));
  });

  createListing = asyncHandler(async (req, res) => {
    const listing = await tenantProductService.createListing({
      tenantId: req.tenantId, payload: req.body, actorId: req.auth.userId, req,
      idempotencyKey: catalogIdempotencyKey(req),
    });
    res.status(201).json(created(listing, { message: 'Listing created' }));
  });

  bulkCreateListings = asyncHandler(async (req, res) => {
    const result = await tenantProductService.bulkCreateListings({
      tenantId: req.tenantId,
      productMasterId: req.body.productMasterId,
      selections: req.body.selections || [],
      selectAll: req.body.selectAll === true,
      defaults: req.body.defaults || {},
      onConflict: req.body.onConflict || 'skip',
      actorId: req.auth.userId,
      req,
    });
    res.status(201).json(created(result, {
      message: `Listed ${result.created.length} variant(s), skipped ${result.skipped.length}`,
    }));
  });

  masterVariants = asyncHandler(async (req, res) => {
    const result = await tenantProductService.masterListingStatus({
      tenantId: req.tenantId, masterId: req.params.id,
    });
    res.status(200).json(success(result, { message: 'Master variants fetched' }));
  });

  listListings = asyncHandler(async (req, res) => {
    const result = await tenantProductService.listListings({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Listings fetched', meta: result.meta }));
  });

  getListing = asyncHandler(async (req, res) => {
    const detail = await tenantProductService.getListingDetail({ tenantId: req.tenantId, listingId: req.params.id });
    res.status(200).json(success(detail, { message: 'Listing fetched' }));
  });

  updateOffer = asyncHandler(async (req, res) => {
    const { expectedVersion, ...patch } = req.body;
    const listing = await tenantProductService.updateOffer({
      tenantId: req.tenantId, listingId: req.params.id, patch, expectedVersion,
      actorId: req.auth.userId, req,
    });
    res.status(200).json(success(listing, { message: 'Listing offer updated' }));
  });

  updatePrice = asyncHandler(async (req, res) => {
    const { price, reason, expectedVersion } = req.body;
    const listing = await tenantProductService.updatePrice({
      tenantId: req.tenantId, listingId: req.params.id, price, reason, expectedVersion,
      actorId: req.auth.userId, req, idempotencyKey: catalogIdempotencyKey(req),
    });
    res.status(200).json(success(listing, { message: 'Price updated' }));
  });

  updateStatus = asyncHandler(async (req, res) => {
    const { status, expectedVersion } = req.body;
    const listing = await tenantProductService.updateStatus({
      tenantId: req.tenantId, listingId: req.params.id, status, expectedVersion, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(listing, { message: 'Listing status updated' }));
  });

  deactivateListing = asyncHandler(async (req, res) => {
    const listing = await tenantProductService.deactivate({
      tenantId: req.tenantId, listingId: req.params.id, expectedVersion: req.body.expectedVersion,
      actorId: req.auth.userId, req,
    });
    res.status(200).json(success(listing, { message: 'Listing deactivated' }));
  });

  // ---------------- inventory ----------------
  setStock = asyncHandler(async (req, res) => {
    const row = await inventoryService.setStock({
      tenantId: req.tenantId, listingId: req.params.id, qty: req.body.qty, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(row, { message: 'Stock set' }));
  });

  adjustStock = asyncHandler(async (req, res) => {
    const row = await inventoryService.adjustStock({
      tenantId: req.tenantId, listingId: req.params.id, delta: req.body.delta, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(row, { message: 'Stock adjusted' }));
  });

  getStock = asyncHandler(async (req, res) => {
    const stock = await inventoryService.getStock({ tenantId: req.tenantId, listingId: req.params.id });
    res.status(200).json(success(stock, { message: 'Stock fetched' }));
  });

  // NOTE (F-12): the tenant-facing stock reserve/release endpoints were
  // removed from the routes — see the inventory section in
  // catalog.tenant.routes.js for the rationale (display/hold state without
  // order linkage diverged from checkout, which commits against qtyOnHand).
  // inventoryService.reserve/release remain for internal order-driven use.

  // ---------------- change requests ----------------
  submitChangeRequest = asyncHandler(async (req, res) => {
    const cr = await changeRequestService.submit({
      ...req.body, tenantId: req.tenantId, actorId: req.auth.userId, req,
    });
    res.status(201).json(created(cr, { message: 'Change request submitted' }));
  });

  listMyChangeRequests = asyncHandler(async (req, res) => {
    const result = await changeRequestService.list({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Change requests fetched', meta: result.meta }));
  });

  cancelChangeRequest = asyncHandler(async (req, res) => {
    const cr = await changeRequestService.cancel({
      requestId: req.params.id, tenantId: req.tenantId, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(cr, { message: 'Change request cancelled' }));
  });

  reviseChangeRequest = asyncHandler(async (req, res) => {
    const cr = await changeRequestService.revise({
      requestId: req.params.id, tenantId: req.tenantId, actorId: req.auth.userId,
      payload: req.body.payload, diff: req.body.diff, note: req.body.note, req,
    });
    res.status(200).json(success(cr, { message: 'Change request revised' }));
  });

  // ---------------- quality control plane ----------------
  evaluateQuality = asyncHandler(async (req, res) => {
    const run = await catalogQualityService.createRun({ tenantId: req.tenantId, actorId: req.auth.userId });
    setImmediate(() => {
      catalogQualityService.processAvailableRuns({ workerId: `api-quality-${process.pid}`, maxRuns: 1 })
        // The durable lease makes API-process interruption safely reclaimable.
        // eslint-disable-next-line no-console
        .catch((error) => console.error('[catalog-quality] durable runner failed:', error));
    });
    res.status(202).json(success(run, { message: run.evaluated ? 'Quality evaluation already in progress' : 'Quality evaluation queued' }));
  });

  listQualityRuns = asyncHandler(async (req, res) => {
    const result = await catalogQualityService.listRuns({ tenantId: req.tenantId, page: req.query.page, limit: req.query.limit });
    res.status(200).json(success(result.items, { message: 'Quality evaluation history fetched', meta: result.meta }));
  });

  qualityRunDetail = asyncHandler(async (req, res) => {
    const result = await catalogQualityService.getRun(req.params.runId, { tenantId: req.tenantId });
    res.status(200).json(success(result, { message: 'Quality evaluation status fetched' }));
  });

  cancelQualityRun = asyncHandler(async (req, res) => {
    const result = await catalogQualityService.cancelRun({ runId: req.params.runId, tenantId: req.tenantId });
    res.status(200).json(success(result, { message: 'Quality evaluation cancellation requested' }));
  });

  retryQualityRun = asyncHandler(async (req, res) => {
    const result = await catalogQualityService.retryRun({ runId: req.params.runId, tenantId: req.tenantId });
    res.status(200).json(success(result, { message: 'Quality evaluation queued for retry' }));
  });

  qualitySummary = asyncHandler(async (req, res) => {
    const result = await catalogQualityService.summary({ tenantId: req.tenantId });
    res.status(200).json(success(result, { message: 'Catalog quality summary fetched' }));
  });

  listQuality = asyncHandler(async (req, res) => {
    const result = await catalogQualityService.list({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Catalog quality assessments fetched', meta: result.meta }));
  });

  qualityDetail = asyncHandler(async (req, res) => {
    const result = await catalogQualityService.detail({ tenantId: req.tenantId, masterId: req.params.masterId });
    res.status(200).json(success(result, { message: 'Catalog quality assessment fetched' }));
  });

  // ---------------- bulk ----------------
  bulkUpload = asyncHandler(async (req, res) => {
    const kind = req.params.kind; // 'price' | 'stock'
    if (!['price', 'stock'].includes(kind)) {
      throw badRequest('kind must be price or stock', 'INVALID_KIND');
    }
    const rows = (await import('../utils/catalog/csv.js')).parseCSV(req.body?.csv || req.body?.file || '');
    if (rows.length === 0) {
      throw badRequest('CSV is empty or malformed', 'EMPTY_CSV');
    }
    if (rows.length > bulkImportService.BULK_MAX_ROWS) {
      throw badRequest(`Too many rows: max ${bulkImportService.BULK_MAX_ROWS} per upload`, 'CSV_TOO_LARGE');
    }
    const dryRun = req.query.dryRun === true || req.query.dryRun === 'true';
    const job = await bulkImportService.createJob({
      kind, rows, tenantId: req.tenantId, actorId: req.auth.userId, dryRun,
    });
    // Kick the durable queue for single-process development. Production workers
    // race on the same atomic lease, so this is safe across API/worker replicas.
    setImmediate(() => {
      bulkImportService.processAvailable({ workerId: `api-${process.pid}`, maxJobs: 1 })
        // Operational crash visibility; the durable lease remains reclaimable.
        // eslint-disable-next-line no-console
        .catch((error) => console.error('[bulk-import] durable runner failed:', error));
    });
    res.status(202).json(success({ jobId: job.id, status: job.status, dryRun }, { message: 'Durable bulk job queued' }));
  });

  getBulkJob = asyncHandler(async (req, res) => {
    const job = await bulkImportService.getJob(req.params.jobId, { tenantId: req.tenantId });
    res.status(200).json(success(job, { message: 'Bulk job status' }));
  });

  listBulkJobs = asyncHandler(async (req, res) => {
    const result = await bulkImportService.listJobs({ tenantId: req.tenantId, page: req.query.page, limit: req.query.limit });
    res.status(200).json(success(result.items, { message: 'Bulk jobs', meta: result.meta }));
  });

  listBulkFailures = asyncHandler(async (req, res) => {
    const result = await bulkImportService.listFailures({
      jobId: req.params.jobId, tenantId: req.tenantId, page: req.query.page, limit: req.query.limit,
    });
    res.status(200).json(success(result.items, { message: 'Bulk job failures', meta: result.meta }));
  });

  cancelBulkJob = asyncHandler(async (req, res) => {
    const job = await bulkImportService.cancelJob({ jobId: req.params.jobId, tenantId: req.tenantId });
    res.status(200).json(success(job, { message: 'Bulk job cancellation accepted' }));
  });

  retryBulkFailures = asyncHandler(async (req, res) => {
    const job = await bulkImportService.retryFailures({ jobId: req.params.jobId, tenantId: req.tenantId });
    setImmediate(() => {
      bulkImportService.processAvailable({ workerId: `api-${process.pid}`, maxJobs: 1 })
        // Operational crash visibility; the durable lease remains reclaimable.
        // eslint-disable-next-line no-console
        .catch((error) => console.error('[bulk-import] durable retry failed:', error));
    });
    res.status(202).json(success(job, { message: 'Failed rows re-queued' }));
  });

  downloadTemplate = asyncHandler(async (req, res) => {
    const kind = req.params.kind;
    const csv = kind === 'stock' ? bulkImportService.stockTemplate() : bulkImportService.priceTemplate();
    res.setHeader('content-type', 'text/csv');
    res.setHeader('content-disposition', `attachment; filename="${kind}-template.csv"`);
    res.status(200).send(csv);
  });
}

export default new CatalogTenantController();
