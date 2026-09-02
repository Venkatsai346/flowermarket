/**
 * MarketplaceController — Phase 5 multi-tenant marketplace.
 *
 * Groups:
 *  - Public: plans, store discovery, storefront, tenant self-service register
 *  - Vendor (role `vendor`): profile, products
 *  - Store owner (tenant admin): branding, plan, invoices, vendor sync
 *  - Platform operator (super_admin): applications, vendors, plans, billing,
 *    cross-tenant analytics, nightly
 */

import storeService from '../services/store.service.js';
import planService from '../services/plan.service.js';
import vendorService from '../services/vendor.service.js';
import billingService from '../services/billing.service.js';
import marketplaceAnalyticsService from '../services/marketplaceAnalytics.service.js';
import maintenanceService from '../services/maintenance.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';

class MarketplaceController {
  // ================= public =================
  listPlans = asyncHandler(async (req, res) => {
    res.status(200).json(success(await planService.listActive(), { message: 'Plans fetched' }));
  });

  listStores = asyncHandler(async (req, res) => {
    const result = await storeService.listStores({ query: req.query });
    res.status(200).json(success(result.items, { message: 'Stores fetched', meta: result.meta }));
  });

  storefront = asyncHandler(async (req, res) => {
    const data = await storeService.storefront({ slug: req.params.slug });
    res.status(200).json(success(data, { message: 'Storefront fetched' }));
  });

  registerTenant = asyncHandler(async (req, res) => {
    const result = await storeService.registerStore({ ...req.body, req });
    res.status(201).json(success(result, { message: 'Store created — owner logged in' }));
  });

  // ================= vendor =================
  applyVendor = asyncHandler(async (req, res) => {
    const result = await vendorService.apply({ userId: req.auth.userId, payload: req.body, req });
    res.status(result.reSubmitted ? 200 : 201).json(success(result, { message: result.reSubmitted ? 'Application updated' : 'Application submitted — pending platform review' }));
  });

  vendorMe = asyncHandler(async (req, res) => {
    const profile = await vendorService.profileForUser({ userId: req.auth.userId });
    res.status(200).json(success(profile, { message: 'Vendor profile fetched' }));
  });

  updateVendorMe = asyncHandler(async (req, res) => {
    const vendor = await vendorService.updateProfile({ userId: req.auth.userId, payload: req.body, req });
    res.status(200).json(success(vendor, { message: 'Vendor profile updated' }));
  });

  vendorProducts = asyncHandler(async (req, res) => {
    const result = await vendorService.listMyProducts({ userId: req.auth.userId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Vendor products fetched', meta: result.meta }));
  });

  createVendorProduct = asyncHandler(async (req, res) => {
    const master = await vendorService.createProduct({ userId: req.auth.userId, payload: req.body });
    res.status(201).json(success(master, { message: 'Product submitted for review' }));
  });

  updateVendorProduct = asyncHandler(async (req, res) => {
    const master = await vendorService.updateProduct({ userId: req.auth.userId, productId: req.params.id, payload: req.body });
    res.status(200).json(success(master, { message: 'Product updated' }));
  });

  // ================= store owner (tenant admin) =================
  myStore = asyncHandler(async (req, res) => {
    const data = await storeService.getStore({ tenantId: req.tenantId });
    res.status(200).json(success(data, { message: 'Store fetched' }));
  });

  updateMyStore = asyncHandler(async (req, res) => {
    const tenant = await storeService.updateStore({ tenantId: req.tenantId, payload: req.body, actorId: req.auth.userId, req });
    res.status(200).json(success(tenant, { message: 'Store updated' }));
  });

  mySubscription = asyncHandler(async (req, res) => {
    const sub = await billingService.currentSubscription({ tenantId: req.tenantId });
    res.status(200).json(success(sub, { message: 'Subscription fetched' }));
  });

  changeMyPlan = asyncHandler(async (req, res) => {
    const result = await billingService.changePlan({ tenantId: req.tenantId, planCode: req.body.planCode, actorId: req.auth.userId, req });
    res.status(200).json(success(result, { message: result.changed ? 'Plan changed (pro-rated from next period)' : 'Already on this plan' }));
  });

  myInvoices = asyncHandler(async (req, res) => {
    const result = await billingService.listInvoices({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Invoices fetched', meta: result.meta }));
  });

  myInvoiceDetail = asyncHandler(async (req, res) => {
    const invoice = await billingService.invoiceDetail({ invoiceId: req.params.id, tenantId: req.tenantId });
    res.status(200).json(success(invoice, { message: 'Invoice fetched' }));
  });

  storeVendors = asyncHandler(async (req, res) => {
    const items = await storeService.storeVendors({ tenantId: req.tenantId });
    res.status(200).json(success(items, { message: 'Store vendors fetched' }));
  });

  syncVendorProducts = asyncHandler(async (req, res) => {
    const result = await storeService.syncVendorProducts({ tenantId: req.tenantId, vendorId: req.params.vendorId, actorId: req.auth.userId, req });
    res.status(200).json(success(result, { message: 'Vendor products synced (idempotent)' }));
  });

  // ================= platform operator (super_admin) =================
  // ---- vendor applications & vendors ----
  listApplications = asyncHandler(async (req, res) => {
    const result = await vendorService.listApplications({ query: req.query });
    res.status(200).json(success(result.items, { message: 'Vendor applications fetched', meta: result.meta }));
  });

  reviewApplication = asyncHandler(async (req, res) => {
    const result = await vendorService.reviewApplication({
      applicationId: req.params.id, decision: req.body.decision, note: req.body.note || null,
      reviewerId: req.auth.userId, req,
    });
    res.status(200).json(success(result, { message: result.alreadyApproved ? 'Already approved' : `Application ${req.body.decision}d` }));
  });

  listVendors = asyncHandler(async (req, res) => {
    const result = await vendorService.listVendors({ query: req.query });
    res.status(200).json(success(result.items, { message: 'Vendors fetched', meta: result.meta }));
  });

  vendorDetail = asyncHandler(async (req, res) => {
    const detail = await vendorService.vendorDetail({ vendorId: req.params.id });
    res.status(200).json(success(detail, { message: 'Vendor fetched' }));
  });

  updateVendor = asyncHandler(async (req, res) => {
    const vendor = await vendorService.updateVendor({ vendorId: req.params.id, payload: req.body, actorId: req.auth.userId, req });
    res.status(200).json(success(vendor, { message: 'Vendor updated' }));
  });

  reviewVendorProduct = asyncHandler(async (req, res) => {
    const master = await vendorService.reviewProduct({
      productId: req.params.id, decision: req.body.decision, note: req.body.note || null,
      reviewerId: req.auth.userId, req,
    });
    res.status(200).json(success(master, { message: `Product ${req.body.decision}d` }));
  });

  // ---- tenants & plans ----
  listTenants = asyncHandler(async (req, res) => {
    const result = await storeService.listTenants({ query: req.query });
    res.status(200).json(success(result.items, { message: 'Tenants fetched', meta: result.meta }));
  });

  listPlansAdmin = asyncHandler(async (req, res) => {
    res.status(200).json(success(await planService.listAll(), { message: 'Plans fetched' }));
  });

  createPlan = asyncHandler(async (req, res) => {
    const plan = await planService.create(req.body);
    res.status(201).json(success(plan, { message: 'Plan created' }));
  });

  updatePlan = asyncHandler(async (req, res) => {
    const plan = await planService.update({ planId: req.params.id, payload: req.body });
    res.status(200).json(success(plan, { message: 'Plan updated' }));
  });

  // ---- billing ----
  adminInvoices = asyncHandler(async (req, res) => {
    const result = await billingService.listInvoices({ query: req.query });
    res.status(200).json(success(result.items, { message: 'Invoices fetched', meta: result.meta }));
  });

  runBillingCycle = asyncHandler(async (req, res) => {
    const result = await billingService.runBillingCycle({ tenantId: req.body.tenantId || null, period: req.body.period || null, actorId: req.auth.userId, req });
    res.status(200).json(success(result, { message: 'Billing cycle complete (idempotent per period)' }));
  });

  payInvoice = asyncHandler(async (req, res) => {
    const result = await billingService.payInvoice({ invoiceId: req.params.id, actorId: req.auth.userId, req });
    res.status(200).json(success(result, { message: result.alreadyPaid ? 'Invoice already paid' : 'Invoice paid' }));
  });

  voidInvoice = asyncHandler(async (req, res) => {
    const invoice = await billingService.voidInvoice({ invoiceId: req.params.id, actorId: req.auth.userId, req });
    res.status(200).json(success(invoice, { message: 'Invoice voided' }));
  });

  overdueSweep = asyncHandler(async (req, res) => {
    const result = await billingService.overdueSweep({ req });
    res.status(200).json(success(result, { message: 'Overdue sweep complete' }));
  });

  // ---- cross-tenant analytics ----
  platformDashboard = asyncHandler(async (req, res) => {
    const data = await marketplaceAnalyticsService.dashboard({ from: req.query.from, to: req.query.to });
    res.status(200).json(success(data, { message: 'Platform analytics fetched' }));
  });

  topTenants = asyncHandler(async (req, res) => {
    const items = await marketplaceAnalyticsService.topTenants({ from: req.query.from, to: req.query.to, limit: req.query.limit });
    res.status(200).json(success(items, { message: 'Top tenants fetched' }));
  });

  topVendors = asyncHandler(async (req, res) => {
    const items = await marketplaceAnalyticsService.topVendors({ from: req.query.from, to: req.query.to, limit: req.query.limit });
    res.status(200).json(success(items, { message: 'Top vendors fetched' }));
  });

  rebuildPlatform = asyncHandler(async (req, res) => {
    const result = await marketplaceAnalyticsService.rebuildPlatformDaily({ from: req.body.from, to: req.body.to, req, actorId: req.auth.userId });
    res.status(200).json(success(result, { message: 'Platform daily rollup rebuilt (idempotent)' }));
  });

  // ---- nightly marketplace pass ----
  marketplaceNightly = asyncHandler(async (req, res) => {
    const result = await maintenanceService.marketplaceNightly({ actorId: req.auth.userId, actorType: 'admin', req, opts: req.body || {} });
    res.status(200).json(success(result, { message: 'Marketplace nightly pass complete (idempotent)' }));
  });
}

export default new MarketplaceController();
