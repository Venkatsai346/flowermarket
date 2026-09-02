import productMasterService from '../services/productMaster.service.js';
import tenantProductService from '../services/tenantProduct.service.js';
import changeRequestService from '../services/changeRequest.service.js';
import inventoryService from '../services/inventory.service.js';
import bulkImportService from '../services/bulkImport.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';
import { badRequest } from '../utils/ApiError.js';

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
  createListing = asyncHandler(async (req, res) => {
    const listing = await tenantProductService.createListing({
      tenantId: req.tenantId, payload: req.body, actorId: req.auth.userId, req,
    });
    res.status(201).json(created(listing, { message: 'Listing created' }));
  });

  listListings = asyncHandler(async (req, res) => {
    const result = await tenantProductService.listListings({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Listings fetched', meta: result.meta }));
  });

  getListing = asyncHandler(async (req, res) => {
    const detail = await tenantProductService.getListingDetail({ tenantId: req.tenantId, listingId: req.params.id });
    res.status(200).json(success(detail, { message: 'Listing fetched' }));
  });

  updatePrice = asyncHandler(async (req, res) => {
    const { price, reason, expectedVersion } = req.body;
    const listing = await tenantProductService.updatePrice({
      tenantId: req.tenantId, listingId: req.params.id, price, reason, expectedVersion,
      actorId: req.auth.userId, req,
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

  reserveStock = asyncHandler(async (req, res) => {
    const row = await inventoryService.reserve({
      tenantId: req.tenantId, listingId: req.params.id, qty: req.body.qty,
      orderRef: req.body.orderRef, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(row, { message: 'Stock reserved' }));
  });

  releaseStock = asyncHandler(async (req, res) => {
    const row = await inventoryService.release({
      tenantId: req.tenantId, listingId: req.params.id, qty: req.body.qty,
      orderRef: req.body.orderRef, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(row, { message: 'Stock released' }));
  });

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
    const job = bulkImportService.createJob({ kind, rows, tenantId: req.tenantId, actorId: req.auth.userId });
    const dryRun = req.query.dryRun === 'true';
    // process in background (fire-and-forget); client polls GET /bulk/:jobId
    bulkImportService.runJob(job, { dryRun }).catch(() => {});
    res.status(202).json(success({ jobId: job.id, status: 'queued', dryRun }, { message: 'Bulk job queued' }));
  });

  getBulkJob = asyncHandler(async (req, res) => {
    const job = bulkImportService.getJob(req.params.jobId);
    res.status(200).json(success(job, { message: 'Bulk job status' }));
  });

  listBulkJobs = asyncHandler(async (req, res) => {
    const jobs = bulkImportService.listJobs({ tenantId: req.tenantId });
    res.status(200).json(success(jobs, { message: 'Bulk jobs' }));
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
