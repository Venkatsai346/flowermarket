import { Router } from 'express';
import CatalogAdminController from '../controllers/catalog.admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { USER_ROLES } from '../constants/enums.js';
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  categoryQuerySchema,
  brandCreateSchema,
  brandUpdateSchema,
  brandVerifySchema,
  brandQuerySchema,
  masterCreateSchema,
  masterUpdateSchema,
  masterQuerySchema,
  variantCreateSchema,
  variantUpdateSchema,
  imageCreateSchema,
  variantImageCreateSchema,
  imagePrimarySchema,
  attributeSetSchema,
  changeRequestReviewSchema,
  changeRequestQuerySchema,
  auditQuerySchema,
  idParamSchema,
  masterVariantParamSchema,
  masterImageParamSchema,
} from '../utils/validators/catalog.validators.js';

const router = Router();

/**
 * /catalog/admin — CENTRAL CATALOG OPS (SUPER_ADMIN ONLY).
 *
 * Everything behind this router mutates PLATFORM-GLOBAL state: masters,
 * categories, brands and the change-request review queue carry no tenantId,
 * so a single write here affects every store on the platform. Store owners
 * (role `admin`) manage their own listings through /catalog/tenant and
 * propose catalog changes through change requests — they must never reach
 * these routes. See docs/catalog-governance.md for the access matrix.
 */
router.use(authenticate, authorize(USER_ROLES.SUPER_ADMIN));

// ---- taxonomy ----
router.post('/categories', validate(categoryCreateSchema), CatalogAdminController.createCategory);
router.get('/categories', validate(categoryQuerySchema, 'query'), CatalogAdminController.listCategories);
router.get('/categories/tree', CatalogAdminController.getCategoryTree);
router.get('/categories/:id', validate(idParamSchema, 'params'), CatalogAdminController.getCategory);
router.patch('/categories/:id', validate(idParamSchema, 'params'), validate(categoryUpdateSchema), CatalogAdminController.updateCategory);
router.delete('/categories/:id', validate(idParamSchema, 'params'), CatalogAdminController.deleteCategory);

router.post('/brands', validate(brandCreateSchema), CatalogAdminController.createBrand);
router.get('/brands', validate(brandQuerySchema, 'query'), CatalogAdminController.listBrands);
router.patch('/brands/:id', validate(idParamSchema, 'params'), validate(brandUpdateSchema), CatalogAdminController.updateBrand);
router.patch('/brands/:id/verify', validate(idParamSchema, 'params'), validate(brandVerifySchema), CatalogAdminController.verifyBrand);
router.delete('/brands/:id', validate(idParamSchema, 'params'), CatalogAdminController.deleteBrand);

// ---- global masters ----
router.post('/masters', validate(masterCreateSchema), CatalogAdminController.createMaster);
router.get('/masters', validate(masterQuerySchema, 'query'), CatalogAdminController.listMasters);
router.get('/masters/:id', validate(idParamSchema, 'params'), CatalogAdminController.getMaster);
router.patch('/masters/:id', validate(idParamSchema, 'params'), validate(masterUpdateSchema), CatalogAdminController.updateMaster);
router.post('/masters/:id/review', validate(idParamSchema, 'params'), CatalogAdminController.reviewMaster);
router.post('/masters/:id/deprecate', validate(idParamSchema, 'params'), CatalogAdminController.deprecateMaster);
router.post('/masters/:id/variants', validate(idParamSchema, 'params'), validate(variantCreateSchema), CatalogAdminController.addVariant);
router.patch('/masters/:id/variants/:variantId', validate(masterVariantParamSchema, 'params'), validate(variantUpdateSchema), CatalogAdminController.updateVariant);
router.delete('/masters/:id/variants/:variantId', validate(masterVariantParamSchema, 'params'), CatalogAdminController.removeVariant);
router.post('/masters/:id/variants/:variantId/images', validate(masterVariantParamSchema, 'params'), validate(variantImageCreateSchema), CatalogAdminController.addVariantImage);
router.post('/masters/:id/images', validate(idParamSchema, 'params'), validate(imageCreateSchema), CatalogAdminController.addImage);
router.delete('/masters/:id/images/:imageId', validate(masterImageParamSchema, 'params'), CatalogAdminController.removeImage);
router.patch('/masters/:id/images/:imageId/primary', validate(masterImageParamSchema, 'params'), validate(imagePrimarySchema), CatalogAdminController.setImagePrimary);
router.put('/masters/:id/attributes', validate(idParamSchema, 'params'), validate(attributeSetSchema), CatalogAdminController.setAttributes);

// ---- review queue ----
router.get('/change-requests', validate(changeRequestQuerySchema, 'query'), CatalogAdminController.listChangeRequests);
router.post('/change-requests/:id/review', validate(idParamSchema, 'params'), validate(changeRequestReviewSchema), CatalogAdminController.reviewChangeRequest);

// ---- audit + events ----
router.get('/audit', validate(auditQuerySchema, 'query'), CatalogAdminController.listAudit);
router.post('/events/drain', CatalogAdminController.drainEvents);
router.post('/events/retry-failed', CatalogAdminController.retryFailedEvents);
router.get('/events/status', CatalogAdminController.eventStatus);

export default router;
