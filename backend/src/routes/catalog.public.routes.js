import { Router } from 'express';
import CatalogPublicController from '../controllers/catalog.public.controller.js';
import { validate } from '../middleware/validate.js';
import { catalogQuerySchema, idParamSchema } from '../utils/validators/catalog.validators.js';

const router = Router();

/**
 * /catalog — customer-facing read endpoints.
 * Public (tenantContext still runs at the router level to resolve the tenant).
 */
router.get('/', validate(catalogQuerySchema, 'query'), CatalogPublicController.search);
router.get('/categories', CatalogPublicController.categories);
router.get('/brands', CatalogPublicController.brands);
router.get('/products/:id', validate(idParamSchema, 'params'), CatalogPublicController.productDetail);
router.get('/products/:id/stock', validate(idParamSchema, 'params'), CatalogPublicController.stockCheck);

export default router;
