/**
 * MarketplaceController — Phase 5 multi-tenant marketplace.
 *
 * Groups:
 *  - Public: plans, store discovery, storefront, tenant self-service register
 *  - Vendor (role `vendor`): profile, products
 *  - Store owner (tenant admin): branding, plan, invoices, vendor sync
 *  - Platform operator (super_admin): applications, vendors, plans, billing,
 *    cross-tenant analytics, nightly
 *  - Billing webhooks (raw-body, signature-verified, no login): async gateway
 *    capture confirmations
 */

import crypto from 'node:crypto';
import { invalidateCache } from '../middleware/responseCache.js';
import storeService from '../services/store.service.js';
import planService from '../services/plan.service.js';
import vendorService from '../services/vendor.service.js';
import billingService from '../services/billing.service.js';
import billingProvider from '../services/billingProvider.service.js';
import entitlementService from '../services/entitlement.service.js';
import marketplaceAnalyticsService from '../services/marketplaceAnalytics.service.js';
import maintenanceService from '../services/maintenance.service.js';
import { renderInvoicePdf } from '../utils/invoicePdf.js';
import { renderInvoiceHtml } from '../utils/invoiceHtml.js';
import Invoice from '../models/invoice.model.js';
import { AppError, notFound } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, unauthorized } from '../utils/ApiError.js';
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

  /** Any logged-in user's own application + vendor state (nulls when none). */
  myApplication = asyncHandler(async (req, res) => {
    const data = await vendorService.myApplication({ userId: req.auth.userId });
    res.status(200).json(success(data, { message: 'Application status fetched' }));
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

  /**
   * Onboarding checklist: what exists, what is missing, and whether the store may
   * be published. Readiness is computed live rather than stored, so it cannot go
   * stale when a hub is deactivated or a slot window passes.
   */
  myOnboarding = asyncHandler(async (req, res) => {
    const data = await storeService.getOnboardingStatus({ tenantId: req.tenantId });
    res.status(200).json(success(data, { message: 'Onboarding status fetched' }));
  });

  updateMyStore = asyncHandler(async (req, res) => {
    const tenant = await storeService.updateStore({ tenantId: req.tenantId, payload: req.body, actorId: req.auth.userId, req });
    // The storefront bootstraps from cached GETs — a saved slide that takes a
    // minute to appear reads as "didn't save". Bust every public surface this
    // write feeds the moment the write commits. ('/marketplace/store' is a
    // substring of both the owner's GET and the public /stores/:slug reads.)
    invalidateCache('/domains/bootstrap');
    invalidateCache('/marketplace/store');
    invalidateCache('/catalog/store/');
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

  /**
   * Owner self-pay: start a payment for one of this store's open invoices.
   * Sync providers (mock) confirm immediately; async providers (Razorpay)
   * return a pending gateway order for the browser checkout — the invoice is
   * confirmed later by the billing webhook, never by the browser.
   */
  payMyInvoice = asyncHandler(async (req, res) => {
    // NOTE: no client provider choice — which money rail runs is a server
    // config decision; letting the browser pick "mock" would mark invoices
    // paid without money moving.
    const result = await billingService.payInvoice({
      invoiceId: req.params.id, tenantId: req.tenantId,
      actorId: req.auth.userId, actorType: 'admin', req,
    });
    res.status(200).json(success(result, {
      message: result.status === 'paid'
        ? 'Invoice paid'
        : result.status === 'already_paid'
          ? 'Invoice already paid'
          : 'Gateway order created — complete payment to confirm',
    }));
  });

  /** Plan limits + live usage for this store (drives the billing-page meters). */
  myUsage = asyncHandler(async (req, res) => {
    const usage = await entitlementService.usage({ tenantId: req.tenantId });
    res.status(200).json(success(usage, { message: 'Plan usage fetched' }));
  });

  requestEmailVerify = asyncHandler(async (req, res) => {
    const result = await storeService.requestEmailVerify({ tenantId: req.tenantId, actorId: req.auth.userId });
    res.status(200).json(success(result, {
      message: result.alreadyVerified ? 'Owner email already verified' : 'Verification code sent to the owner email',
    }));
  });

  confirmEmailVerify = asyncHandler(async (req, res) => {
    const result = await storeService.confirmEmailVerify({
      tenantId: req.tenantId, code: req.body.code, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(result, { message: 'Owner email verified' }));
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

  setTenantStatus = asyncHandler(async (req, res) => {
    const result = await storeService.setStatus({
      tenantId: req.params.id,
      status: req.body.status,
      reason: req.body.reason || null,
      actorId: req.auth.userId,
      req,
    });
    res.status(200).json(success(result.tenant, {
      message: result.unchanged ? 'Already in this state' : `Store ${req.body.status}`,
    }));
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

  /**
   * GET /marketplace/admin/billing/invoices/:id — platform-scoped invoice
   * detail (no tenant filter; super_admin sees every tenant's invoice).
   * The shared client already called this; the route was missing.
   */
  adminInvoiceDetail = asyncHandler(async (req, res) => {
    const invoice = await billingService.invoiceDetail({ invoiceId: req.params.id });
    res.status(200).json(success(invoice, { message: 'Invoice fetched' }));
  });

  /**
   * GET /marketplace/admin/billing/invoices/:id/pdf — platform-scoped invoice PDF download.
   */
  adminInvoicePdf = asyncHandler(async (req, res) => {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw notFound('Invoice not found');

    const doc = {
      docType: invoice.status === 'voided' ? 'credit_note' : 'invoice',
      number: invoice.number,
      orderNumber: `INV-${invoice.number}`,
      supplyDate: invoice.period?.from || invoice.createdAt,
      supplier: { tradeName: 'Bloomy Marketplace', name: 'Bloomy Platform' },
      recipient: { name: `Tenant ${invoice.tenantId}` },
      lines: (invoice.lineItems || []).map((li) => ({
        description: li.label,
        hsnCode: '--',
        qty: li.qty || 1,
        uom: 'NOS',
        unitPricePaise: li.unitAmount || 0,
        taxableValuePaise: li.amount || 0,
        rateBps: 0,
        cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0,
        lineTotalPaise: li.amount || 0,
      })),
      totals: {
        taxableValuePaise: invoice.subtotal || 0,
        cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0,
        roundOffPaise: 0,
        grandTotalPaise: invoice.total || 0,
      },
      amountInWords: '',
    };

    const pdf = renderInvoicePdf(doc);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.number}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  });

  /**
   * POST /marketplace/admin/billing/invoices/:id/credit-note — generate a credit note
   * PDF for a voided invoice.
   */
  adminCreditNotePdf = asyncHandler(async (req, res) => {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) throw notFound('Invoice not found');

    const doc = {
      docType: 'credit_note',
      number: `CN-${invoice.number}`,
      originalNumber: invoice.number,
      orderNumber: `INV-${invoice.number}`,
      supplyDate: invoice.period?.from || invoice.createdAt,
      supplier: { tradeName: 'Bloomy Marketplace', name: 'Bloomy Platform' },
      recipient: { name: `Tenant ${invoice.tenantId}` },
      lines: (invoice.lineItems || []).map((li) => ({
        description: li.label,
        hsnCode: '--',
        qty: li.qty || 1,
        uom: 'NOS',
        unitPricePaise: li.unitAmount || 0,
        taxableValuePaise: li.amount || 0,
        rateBps: 0,
        cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0,
        lineTotalPaise: li.amount || 0,
      })),
      totals: {
        taxableValuePaise: invoice.subtotal || 0,
        cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0,
        roundOffPaise: 0,
        grandTotalPaise: invoice.total || 0,
      },
      amountInWords: '',
    };

    const pdf = renderInvoicePdf(doc);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="CN-${invoice.number}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
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

  // ================= billing webhooks (raw body, no login) =================
  /**
   * Razorpay billing webhook. Verify-before-parse, then route through the
   * single billing event pipeline (idempotent + amount-checked). Always acks
   * 200 except on a bad signature — 4xx on operator-fixable states would make
   * the gateway storm retries.
   */
  webhookBillingRazorpay = asyncHandler(async (req, res) => {
    const rawBody = req.body; // Buffer (express.raw)
    const signature = req.headers['x-razorpay-signature'] || '';
    const verified = billingProvider.verifyWebhook('razorpay', rawBody, signature);
    if (!verified.ok) {
      throw unauthorized('Webhook signature verification failed', 'WEBHOOK_SIGNATURE_INVALID');
    }
    const event = JSON.parse(rawBody.toString('utf8') || '{}');
    const { event: eventName } = event;
    const entity = event.payload?.payment?.entity || event.payload?.order?.entity || {};
    const result = await billingService.applyBillingWebhook({
      provider: 'razorpay',
      eventType: eventName,
      gatewayOrderId: entity.order_id || entity.receipt || null,
      gatewayPaymentId: entity.id || null,
      amountPaise: entity.amount ?? null,
    });
    return res.status(200).json(success({ result: result.status }, { message: `Webhook ${result.status}` }));
  });

  /**
   * Mock billing webhook — exercises the async capture path without real
   * gateway keys: POST { gatewayOrderId, amountPaise? } with an HMAC signature.
   */
  webhookBillingMock = asyncHandler(async (req, res) => {
    const rawBody = req.body;
    const signature = req.headers['x-mock-signature'] || '';
    const verified = billingProvider.verifyWebhook('mock', rawBody, signature);
    if (!verified.ok) {
      throw unauthorized('Webhook signature verification failed', 'WEBHOOK_SIGNATURE_INVALID');
    }
    const parsed = JSON.parse(rawBody.toString('utf8') || '{}');
    const { gatewayOrderId, gatewayPaymentId, amountPaise } = parsed;
    if (!gatewayOrderId) {
      throw badRequest('gatewayOrderId is required', 'GATEWAY_ORDER_REQUIRED');
    }
    const result = await billingService.applyBillingWebhook({
      provider: 'mock',
      eventType: 'payment.captured',
      gatewayOrderId,
      gatewayPaymentId: gatewayPaymentId || `mock_${crypto.createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`,
      amountPaise: amountPaise ?? null,
    });
    return res.status(200).json(success({ result: result.status }, { message: `Mock webhook ${result.status}` }));
  });
}

export default new MarketplaceController();
