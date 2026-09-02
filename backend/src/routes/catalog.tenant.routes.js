import { Router } from 'express';
import CatalogTenantController from '../controllers/catalog.tenant.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../constants/enums.js';
import {
  masterProposeSchema,
  listingCreateSchema,
  listingQuerySchema,
  listingUpdatePriceSchema,
  listingUpdateStatusSchema,
  changeRequestCreateSchema,
  changeRequestQuerySchema,
  idParamSchema,
} from '../utils/validators/catalog.validators.js';

const router = Router();

/**
 * /catalog/tenant — tenant-portal catalog management.
 *
 * RBAC (Phase 6.0): these routes write PRICE, STOCK and LISTING STATUS, so they
 * are restricted to the roles that may run a store's catalog. Previously the
 * router only ran `authenticate`, which meant any authenticated user of the
 * tenant — including a plain `customer` — could change prices.
 */
router.use(authenticate, authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.VENDOR));

// ---- propose a new global SKU (goes to admin review) ----
router.post('/masters/propose', validate(masterProposeSchema), CatalogTenantController.proposeMaster);

// ---- listings (tenant-scoped writes, optimistic-locked) ----
router.post('/listings', validate(listingCreateSchema), CatalogTenantController.createListing);
router.get('/listings', validate(listingQuerySchema, 'query'), CatalogTenantController.listListings);
router.get('/listings/:id', validate(idParamSchema, 'params'), CatalogTenantController.getListing);
router.patch('/listings/:id/price', validate(idParamSchema, 'params'), validate(listingUpdatePriceSchema), CatalogTenantController.updatePrice);
router.patch('/listings/:id/status', validate(idParamSchema, 'params'), validate(listingUpdateStatusSchema), CatalogTenantController.updateStatus);
router.post('/listings/:id/deactivate', validate(idParamSchema, 'params'), CatalogTenantController.deactivateListing);

// ---- inventory ----
router.get('/listings/:id/stock', validate(idParamSchema, 'params'), CatalogTenantController.getStock);
router.put('/listings/:id/stock', validate(idParamSchema, 'params'), CatalogTenantController.setStock);
router.patch('/listings/:id/stock', validate(idParamSchema, 'params'), CatalogTenantController.adjustStock);
router.post('/listings/:id/stock/reserve', validate(idParamSchema, 'params'), CatalogTenantController.reserveStock);
router.post('/listings/:id/stock/release', validate(idParamSchema, 'params'), CatalogTenantController.releaseStock);

// ---- change requests ----
router.post('/change-requests', validate(changeRequestCreateSchema), CatalogTenantController.submitChangeRequest);
router.get('/change-requests', validate(changeRequestQuerySchema, 'query'), CatalogTenantController.listMyChangeRequests);
router.post('/change-requests/:id/cancel', validate(idParamSchema, 'params'), CatalogTenantController.cancelChangeRequest);
router.post('/change-requests/:id/revise', validate(idParamSchema, 'params'), CatalogTenantController.reviseChangeRequest);

// ---- bulk ----
router.post('/bulk/:kind', CatalogTenantController.bulkUpload);
router.get('/bulk/jobs', CatalogTenantController.listBulkJobs);
router.get('/bulk/jobs/:jobId', CatalogTenantController.getBulkJob);
router.get('/bulk/template/:kind', CatalogTenantController.downloadTemplate);

export default router;
