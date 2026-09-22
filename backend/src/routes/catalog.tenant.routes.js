import { Router } from 'express';
import CatalogTenantController from '../controllers/catalog.tenant.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../constants/enums.js';
import {
  masterProposeSchema,
  masterQuerySchema,
  listingCreateSchema,
  listingBulkSchema,
  listingQuerySchema,
  listingUpdatePriceSchema,
  listingUpdateOfferSchema,
  listingUpdateStatusSchema,
  changeRequestCreateSchema,
  changeRequestQuerySchema,
  idParamSchema,
  stockSetSchema,
  stockAdjustSchema,
  versionOnlySchema,
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
// Read-only master discovery for store owners. The controller forcibly applies
// status=active even if a caller supplies another status.
router.get('/masters', validate(masterQuerySchema, 'query'), CatalogTenantController.listAvailableMasters);
router.post('/listings', validate(listingCreateSchema), CatalogTenantController.createListing);
// NOTE: declared BEFORE /listings/:id reads so 'bulk' never matches :id.
router.post('/listings/bulk', validate(listingBulkSchema), CatalogTenantController.bulkCreateListings);
// Variant-selection grid for one master (variants + existing listings).
router.get('/masters/:id/variants', validate(idParamSchema, 'params'), CatalogTenantController.masterVariants);
router.get('/listings', validate(listingQuerySchema, 'query'), CatalogTenantController.listListings);
router.get('/listings/:id', validate(idParamSchema, 'params'), CatalogTenantController.getListing);
router.patch('/listings/:id/price', validate(idParamSchema, 'params'), validate(listingUpdatePriceSchema), CatalogTenantController.updatePrice);
router.patch('/listings/:id/offer', validate(idParamSchema, 'params'), validate(listingUpdateOfferSchema), CatalogTenantController.updateOffer);
router.patch('/listings/:id/status', validate(idParamSchema, 'params'), validate(listingUpdateStatusSchema), CatalogTenantController.updateStatus);
router.post('/listings/:id/deactivate', validate(idParamSchema, 'params'), validate(versionOnlySchema), CatalogTenantController.deactivateListing);

// ---- inventory ----
// NOTE (F-12): the tenant-facing reserve/release endpoints were removed.
// `qtyReserved` is display/hold state — but the checkout saga commits
// directly against `qtyOnHand` (see inventoryService.commitForOrder), so a
// tenant-writable reservation with no order linkage or TTL let a store pin
// arbitrary stock and make displayed availability diverge from what
// checkout can actually sell. The service-level reserve/release remain for
// internal (order-driven) use; expose them again only with hold expiry.
router.get('/listings/:id/stock', validate(idParamSchema, 'params'), CatalogTenantController.getStock);
router.put('/listings/:id/stock', validate(idParamSchema, 'params'), validate(stockSetSchema), CatalogTenantController.setStock);
router.patch('/listings/:id/stock', validate(idParamSchema, 'params'), validate(stockAdjustSchema), CatalogTenantController.adjustStock);

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
