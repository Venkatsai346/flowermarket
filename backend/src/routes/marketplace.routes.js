import { Router } from 'express';
import MarketplaceController from '../controllers/marketplace.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import TokenService from '../utils/jwt.js';
import config from '../config/index.js';

/**
 * Store-owner routes: the owner's access token IS their store's tenant.
 * When no x-tenant-id header is present, resolve req.tenantId from the token
 * BEFORE authenticate runs (authenticate would otherwise reject a token whose
 * tenant differs from the header/default-resolved tenant). Explicit headers
 * still win for multi-tenant platform clients.
 */
function tokenTenant(req, res, next) {
  const header = req.headers[config.tenant.tenantHeader?.toLowerCase()] || null;
  if (header) return next(); // explicit tenant wins
  const authz = req.headers.authorization || '';
  const [scheme, token] = authz.split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const payload = TokenService.verifyAccessToken(token);
      if (payload?.tenant) req.tenantId = payload.tenant;
    } catch {
      // let authenticate produce the proper 401
    }
  }
  next();
}
import {
  storeRegisterSchema,
  storeListQuerySchema,
  dateRangeQuerySchema,
  vendorApplySchema,
  vendorProfileUpdateSchema,
  vendorProductCreateSchema,
  vendorProductUpdateSchema,
  vendorStatusQuerySchema,
  storeUpdateSchema,
  planChangeSchema,
  invoiceListQuerySchema,
  applicationReviewSchema,
  vendorAdminUpdateSchema,
  planCreateSchema,
  planUpdateSchema,
  billingCycleSchema,
  rebuildPlatformSchema,
  nightlyMarketplaceSchema,
} from '../utils/validators/marketplace.validators.js';
import { USER_ROLES } from '../constants/enums.js';

const router = Router();

/**
 * /marketplace — Phase 5 multi-tenant marketplace.
 *
 *  Public      /plans, /stores, /stores/:slug, /tenants/register
 *  Vendor      /vendor/*            (role vendor)
 *  Store owner /store/*             (tenant admin — token tenant = their store)
 *  Platform    /admin/*             (super_admin only)
 */

// ---------------- public ----------------
router.get('/plans', MarketplaceController.listPlans);
router.get('/stores', validate(storeListQuerySchema, 'query'), MarketplaceController.listStores);
router.get('/stores/:slug', MarketplaceController.storefront);
router.post('/tenants/register', validate(storeRegisterSchema), MarketplaceController.registerTenant);

// ---------------- vendor ----------------
// apply is open to ANY authenticated user (you aren't a vendor yet)
router.post('/vendor/apply', authenticate, validate(vendorApplySchema), MarketplaceController.applyVendor);

// the rest of /vendor requires the vendor role (granted ONLY by an approved application)
router.use('/vendor', authenticate, authorize(USER_ROLES.VENDOR));
router.get('/vendor/me', MarketplaceController.vendorMe);
router.patch('/vendor/me', validate(vendorProfileUpdateSchema), MarketplaceController.updateVendorMe);
router.get('/vendor/products', validate(vendorStatusQuerySchema, 'query'), MarketplaceController.vendorProducts);
router.post('/vendor/products', validate(vendorProductCreateSchema), MarketplaceController.createVendorProduct);
router.patch('/vendor/products/:id', validate(vendorProductUpdateSchema), MarketplaceController.updateVendorProduct);

// ---------------- store owner (tenant admin) ----------------
router.use('/store', tokenTenant, authenticate, authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN));
router.get('/store', MarketplaceController.myStore);
router.patch('/store', validate(storeUpdateSchema), MarketplaceController.updateMyStore);
router.get('/store/subscription', MarketplaceController.mySubscription);
router.patch('/store/plan', validate(planChangeSchema), MarketplaceController.changeMyPlan);
router.get('/store/invoices', validate(invoiceListQuerySchema, 'query'), MarketplaceController.myInvoices);
router.get('/store/invoices/:id', MarketplaceController.myInvoiceDetail);
router.get('/store/vendors', MarketplaceController.storeVendors);
router.post('/store/vendors/:vendorId/sync', MarketplaceController.syncVendorProducts);

// ---------------- platform operator (super_admin) ----------------
router.use('/admin', authenticate, authorize(USER_ROLES.SUPER_ADMIN));

// vendor applications + vendors
router.get('/admin/vendor-applications', validate(vendorStatusQuerySchema, 'query'), MarketplaceController.listApplications);
router.post('/admin/vendor-applications/:id/review', validate(applicationReviewSchema), MarketplaceController.reviewApplication);
router.get('/admin/vendors', validate(vendorStatusQuerySchema, 'query'), MarketplaceController.listVendors);
router.get('/admin/vendors/:id', MarketplaceController.vendorDetail);
router.patch('/admin/vendors/:id', validate(vendorAdminUpdateSchema), MarketplaceController.updateVendor);
router.post('/admin/vendor-products/:id/review', validate(applicationReviewSchema), MarketplaceController.reviewVendorProduct);

// tenants + plans
router.get('/admin/tenants', validate(vendorStatusQuerySchema, 'query'), MarketplaceController.listTenants);
router.get('/admin/plans', MarketplaceController.listPlansAdmin);
router.post('/admin/plans', validate(planCreateSchema), MarketplaceController.createPlan);
router.patch('/admin/plans/:id', validate(planUpdateSchema), MarketplaceController.updatePlan);

// billing
router.get('/admin/billing/invoices', validate(invoiceListQuerySchema, 'query'), MarketplaceController.adminInvoices);
router.post('/admin/billing/cycle', validate(billingCycleSchema), MarketplaceController.runBillingCycle);
router.get('/admin/billing/invoices/:id', MarketplaceController.adminInvoiceDetail);
router.post('/admin/billing/invoices/:id/pay', MarketplaceController.payInvoice);
router.post('/admin/billing/invoices/:id/void', MarketplaceController.voidInvoice);
router.post('/admin/billing/overdue-sweep', MarketplaceController.overdueSweep);

// cross-tenant analytics
router.get('/admin/analytics/dashboard', validate(dateRangeQuerySchema, 'query'), MarketplaceController.platformDashboard);
router.get('/admin/analytics/top-tenants', validate(dateRangeQuerySchema, 'query'), MarketplaceController.topTenants);
router.get('/admin/analytics/top-vendors', validate(dateRangeQuerySchema, 'query'), MarketplaceController.topVendors);
router.post('/admin/analytics/rebuild', validate(rebuildPlatformSchema), MarketplaceController.rebuildPlatform);

// nightly marketplace pass
router.post('/admin/nightly', validate(nightlyMarketplaceSchema), MarketplaceController.marketplaceNightly);

export default router;
