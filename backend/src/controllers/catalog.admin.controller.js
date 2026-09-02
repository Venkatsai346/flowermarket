import categoryService from '../services/category.service.js';
import brandService from '../services/brand.service.js';
import productMasterService from '../services/productMaster.service.js';
import changeRequestService from '../services/changeRequest.service.js';
import auditService from '../services/audit.service.js';
import catalogEventService from '../services/catalogEvent.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';
import { notFound } from '../utils/ApiError.js';

/**
 * CatalogAdminController — central catalog-ops endpoints (ADMIN / SUPER_ADMIN).
 * Owns taxonomy (categories, brands), global masters, review queue, audit.
 */
class CatalogAdminController {
  // ---------------- categories ----------------
  createCategory = asyncHandler(async (req, res) => {
    const cat = await categoryService.create({ payload: req.body, actorId: req.auth.userId, req });
    res.status(201).json(created(cat, { message: 'Category created' }));
  });

  updateCategory = asyncHandler(async (req, res) => {
    const cat = await categoryService.update({ id: req.params.id, patch: req.body, actorId: req.auth.userId, req });
    res.status(200).json(success(cat, { message: 'Category updated' }));
  });

  listCategories = asyncHandler(async (req, res) => {
    const result = await categoryService.list(req.query);
    res.status(200).json(success(result.items, { message: 'Categories fetched', meta: result.meta }));
  });

  getCategoryTree = asyncHandler(async (req, res) => {
    const tree = await categoryService.tree({ includeInactive: req.query.includeInactive === 'true' });
    res.status(200).json(success(tree, { message: 'Category tree fetched' }));
  });

  deleteCategory = asyncHandler(async (req, res) => {
    const result = await categoryService.remove({ id: req.params.id, actorId: req.auth.userId, req });
    res.status(200).json(success(result, { message: 'Category removed' }));
  });

  // ---------------- brands ----------------
  createBrand = asyncHandler(async (req, res) => {
    const brand = await brandService.create({ payload: req.body, actorId: req.auth.userId, req });
    res.status(201).json(created(brand, { message: 'Brand created' }));
  });

  updateBrand = asyncHandler(async (req, res) => {
    const brand = await brandService.update({ id: req.params.id, patch: req.body, actorId: req.auth.userId, req });
    res.status(200).json(success(brand, { message: 'Brand updated' }));
  });

  verifyBrand = asyncHandler(async (req, res) => {
    const brand = await brandService.verify({
      id: req.params.id, verified: req.body.verified, note: req.body.note, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(brand, { message: `Brand ${req.body.verified ? 'verified' : 'unverified'}` }));
  });

  listBrands = asyncHandler(async (req, res) => {
    const result = await brandService.list(req.query);
    res.status(200).json(success(result.items, { message: 'Brands fetched', meta: result.meta }));
  });

  deleteBrand = asyncHandler(async (req, res) => {
    const result = await brandService.remove({ id: req.params.id, actorId: req.auth.userId, req });
    res.status(200).json(success(result, { message: 'Brand removed' }));
  });

  // ---------------- masters ----------------
  createMaster = asyncHandler(async (req, res) => {
    const master = await productMasterService.createMaster({
      payload: req.body, actorId: req.auth.userId, status: req.body.status || 'active', req,
    });
    res.status(201).json(created(master, { message: 'Product master created' }));
  });

  listMasters = asyncHandler(async (req, res) => {
    const result = await productMasterService.listMasters({ query: req.query });
    res.status(200).json(success(result.items, { message: 'Masters fetched', meta: result.meta }));
  });

  getMaster = asyncHandler(async (req, res) => {
    const master = await productMasterService.getMaster(req.params.id);
    res.status(200).json(success(master, { message: 'Master fetched' }));
  });

  updateMaster = asyncHandler(async (req, res) => {
    const { expectedVersion, ...patch } = req.body;
    const master = await productMasterService.updateGlobalFields({
      id: req.params.id, patch, expectedVersion, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(master, { message: 'Master updated' }));
  });

  reviewMaster = asyncHandler(async (req, res) => {
    const master = await productMasterService.reviewCreateMaster({
      masterId: req.params.id, decision: req.body.decision, note: req.body.note, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(master, { message: `Master ${req.body.decision}d` }));
  });

  deprecateMaster = asyncHandler(async (req, res) => {
    const master = await productMasterService.deprecate({
      id: req.params.id, actorId: req.auth.userId, note: req.body.note, req,
    });
    res.status(200).json(success(master, { message: 'Master deprecated' }));
  });

  // ---------------- variants / images / attributes ----------------
  addVariant = asyncHandler(async (req, res) => {
    const { expectedVersion, ...payload } = req.body;
    const variant = await productMasterService.addVariant({
      id: req.params.id, payload, expectedVersion, actorId: req.auth.userId, req,
    });
    res.status(201).json(created(variant, { message: 'Variant added' }));
  });

  addImage = asyncHandler(async (req, res) => {
    const { expectedVersion, ...payload } = req.body;
    const image = await productMasterService.addImage({
      id: req.params.id, payload, expectedVersion, actorId: req.auth.userId, req,
    });
    res.status(201).json(created(image, { message: 'Image added' }));
  });

  setAttributes = asyncHandler(async (req, res) => {
    const { attributes, expectedVersion } = req.body;
    const master = await productMasterService.setAttributes({
      id: req.params.id, attributes, expectedVersion, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(master, { message: 'Attributes updated' }));
  });

  // ---------------- review queue ----------------
  listChangeRequests = asyncHandler(async (req, res) => {
    const result = await changeRequestService.list({ query: req.query, isAdmin: true });
    res.status(200).json(success(result.items, { message: 'Change requests fetched', meta: result.meta }));
  });

  reviewChangeRequest = asyncHandler(async (req, res) => {
    const cr = await changeRequestService.review({
      requestId: req.params.id, decision: req.body.decision, note: req.body.note, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(cr, { message: `Request ${req.body.decision}d` }));
  });

  // ---------------- audit + events ----------------
  listAudit = asyncHandler(async (req, res) => {
    const result = await auditService.query({
      filters: req.query, isAdmin: true, page: req.query.page, limit: req.query.limit,
    });
    res.status(200).json(success(result.items, { message: 'Audit logs fetched', meta: result.meta }));
  });

  drainEvents = asyncHandler(async (req, res) => {
    const result = await catalogEventService.drain({ limit: Number(req.query.limit) || 50 });
    res.status(200).json(success(result, { message: 'Events drained' }));
  });

  eventStatus = asyncHandler(async (req, res) => {
    const status = await catalogEventService.status();
    res.status(200).json(success(status, { message: 'Event outbox status' }));
  });

  getCategory = asyncHandler(async (req, res) => {
    const cat = await categoryService.getById(req.params.id);
    res.status(200).json(success(cat, { message: 'Category fetched' }));
  });
}

export default new CatalogAdminController();
