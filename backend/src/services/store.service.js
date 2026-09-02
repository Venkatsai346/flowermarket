/**
 * StoreService — tenant self-service + storefront (Phase 5).
 *
 * registerStore(): public self-service — creates Tenant + owner admin user +
 * auth config + trial subscription, returns owner tokens (smooth onboarding).
 * Branding/discovery/publish are store-owner ops; syncVendorProducts routes
 * an approved vendor's products into a marketplace-enabled store (idempotent
 * on productMasterId, reusing the Phase-2 TenantProduct listing mechanics).
 */

import Tenant from '../models/tenant.model.js';
import TenantAuthConfig from '../models/tenantAuthConfig.model.js';
import User from '../models/user.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import Vendor from '../models/vendor.model.js';
import planService from './plan.service.js';
import billingService from './billing.service.js';
import auditService from './audit.service.js';
import { serializeList } from '../utils/serialize.js';
import { badRequest, conflict, notFound, forbidden } from '../utils/ApiError.js';
import { roundMoney } from '../utils/money.js';
import config from '../config/index.js';
import { USER_ROLES, PRODUCT_MASTER_STATUS, TENANT_LISTING_STATUS } from '../constants/enums.js';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class StoreService {
  /** Create a store (public). Idempotent-ish: slug unique → 409 on retry. */
  async registerStore({ name, slug, plan = 'free', planCode = null, contactEmail = null, owner = {}, req = null }) {
    if (!SLUG_RE.test(slug)) throw badRequest('Slug must be lowercase letters, numbers, hyphens', 'BAD_SLUG');
    if (config.marketplace.reservedSlugs.includes(slug)) throw conflict('This slug is reserved', 'SLUG_RESERVED');

    const existing = await Tenant.findOne({ slug });
    if (existing) throw conflict('Tenant slug already exists', 'TENANT_SLUG_EXISTS');

    const planDoc = await planService.getByCode(planCode || plan);
    const tenant = await Tenant.create({
      name: name.trim(),
      slug,
      type: 'business',
      contactEmail: (contactEmail || '').toLowerCase() || null,
      plan: planDoc.code,
      planExpiresAt: null,
      features: {
        slotsEnabled: true,
        paymentsEnabled: true,
        subscriptionsEnabled: Boolean(planDoc.features?.marketplaceEnabled),
        marketplaceEnabled: Boolean(planDoc.features?.marketplaceEnabled),
      },
      status: 'active',
      store: { isPublished: false, onboardingStatus: 'registered' },
    });

    // ---- auth config ----
    await TenantAuthConfig.create({ tenantId: tenant.id });

    // ---- owner admin (NEVER super_admin; token tenant = this new store) ----
    const { default: AuthService } = await import('./auth.service.js');
    const ownerUser = await User.create({
      tenantId: tenant.id,
      email: owner.email ? { address: String(owner.email).toLowerCase(), verified: true, verifiedAt: new Date() } : { verified: false },
      phone: owner.phone ? { countryCode: '+91', number: owner.phone, verified: true } : { verified: false },
      role: USER_ROLES.ADMIN,
      status: 'active',
      profile: { firstName: owner.firstName || 'Store', lastName: owner.lastName || 'Owner' },
      loginMethods: owner.email ? ['email_password'] : ['phone_otp'],
      defaultTenantId: tenant.id,
    });
    if (owner.password) {
      await ownerUser.setPassword(owner.password);
      await ownerUser.save();
    }
    tenant.ownerUserId = ownerUser._id;
    await tenant.save();

    // ---- trial subscription (plan pricing snapshot) ----
    await billingService.ensureSubscription({
      tenantId: tenant._id,
      planCode: planDoc.code,
      commissionRateBps: planDoc.commissionRateBps,
      trialDays: planDoc.trialDays,
    });

    await auditService.record({
      action: 'create', entityType: 'tenant', entityId: tenant._id,
      tenantId: tenant._id, actorId: ownerUser._id, actorType: 'tenant',
      after: { slug: tenant.slug, name: tenant.name, plan: planDoc.code }, req,
    }).catch(() => {});

    const tokens = await AuthService.issueTokens(ownerUser);
    return { tenant, owner: ownerUser, tokens };
  }

  // ---------------- discovery / storefront (public) ----------------
  async listStores({ query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const q = { 'store.isPublished': true, status: 'active' };
    if (query.search) {
      q.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { slug: { $regex: query.search, $options: 'i' } },
        { 'store.tagline': { $regex: query.search, $options: 'i' } },
      ];
    }
    const [docs, total] = await Promise.all([
      Tenant.find(q).select('name slug logoUrl theme store contactEmail createdAt')
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Tenant.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  /** Public storefront: branding + (when marketplace mode) vendor products + vendors. */
  async storefront({ slug }) {
    const tenant = await Tenant.findOne({ slug, status: 'active' }).lean();
    if (!tenant || !tenant.store?.isPublished) throw notFound('Store not found', 'STORE_NOT_FOUND');

    let vendorProducts = [];
    let vendors = [];
    if (tenant.features?.marketplaceEnabled) {
      const masters = await ProductMaster.find({
        vendorId: { $ne: null },
        status: PRODUCT_MASTER_STATUS.ACTIVE,
        marketplaceListed: true,
      }).select('_id title skuGlobal type description vendorId').sort({ createdAt: -1 }).limit(24).lean();
      vendorProducts = serializeList(masters);
      const vendorIds = [...new Set(masters.map((m) => m.vendorId).filter(Boolean))];
      if (vendorIds.length) {
        vendors = serializeList(await Vendor.find({ _id: { $in: vendorIds }, status: 'active' })
          .select('businessName slug city categories').lean());
      }
    }

    return {
      store: {
        name: tenant.name,
        slug: tenant.slug,
        logoUrl: tenant.logoUrl || null,
        bannerUrl: tenant.store?.bannerUrl || null,
        tagline: tenant.store?.tagline || null,
        description: tenant.store?.description || null,
        theme: tenant.theme || null,
        socialLinks: tenant.store?.socialLinks || {},
        contactEmail: tenant.contactEmail || null,
        marketplaceEnabled: Boolean(tenant.features?.marketplaceEnabled),
      },
      vendorProducts,
      vendors,
    };
  }

  // ---------------- store owner ops ----------------
  async getStore({ tenantId }) {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw notFound('Store not found', 'STORE_NOT_FOUND');
    const sub = await billingService.currentSubscription({ tenantId });
    return { tenant, subscription: sub };
  }

  async updateStore({ tenantId, payload, actorId = null, req = null }) {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw notFound('Store not found', 'STORE_NOT_FOUND');

    const before = { store: tenant.store, theme: tenant.theme, logoUrl: tenant.logoUrl, name: tenant.name };
    if (payload.name) tenant.name = String(payload.name).trim();
    if (payload.logoUrl !== undefined) tenant.logoUrl = payload.logoUrl || null;
    if (payload.theme) {
      tenant.theme = { ...(tenant.theme || {}), ...payload.theme };
    }
    tenant.store = {
      ...(tenant.store || {}),
      tagline: payload.tagline !== undefined ? payload.tagline || null : tenant.store?.tagline || null,
      description: payload.description !== undefined ? payload.description || null : tenant.store?.description || null,
      bannerUrl: payload.bannerUrl !== undefined ? payload.bannerUrl || null : tenant.store?.bannerUrl || null,
      socialLinks: payload.socialLinks ? { ...(tenant.store?.socialLinks || {}), ...payload.socialLinks } : tenant.store?.socialLinks || {},
    };
    if (payload.isPublished !== undefined) {
      tenant.store.isPublished = Boolean(payload.isPublished);
      if (tenant.store.isPublished) tenant.store.onboardingStatus = 'active';
    }
    await tenant.save();

    await auditService.record({
      action: 'update', entityType: 'tenant', entityId: tenant._id,
      tenantId, actorId, actorType: 'admin', before, after: { store: tenant.store }, req,
    }).catch(() => {});
    return tenant;
  }

  /** Sync an approved vendor's products into this store (marketplace mode only). */
  async syncVendorProducts({ tenantId, vendorId, actorId = null, req = null }) {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw notFound('Store not found', 'STORE_NOT_FOUND');
    if (!tenant.features?.marketplaceEnabled) {
      throw forbidden('Marketplace mode is not enabled for this store', 'MARKETPLACE_DISABLED');
    }
    const vendor = await Vendor.findOne({ _id: vendorId, status: 'active' });
    if (!vendor) throw notFound('Vendor not found', 'VENDOR_NOT_FOUND');

    const masters = await ProductMaster.find({
      vendorId,
      status: PRODUCT_MASTER_STATUS.ACTIVE,
      marketplaceListed: true,
    }).select('_id title skuGlobal type categoryId brandId').lean();

    let created = 0; let skipped = 0; let failed = 0;
    for (const m of masters) {
      const exists = await TenantProduct.findOne({ tenantId, productMasterId: m._id });
      if (exists) { skipped += 1; continue; }
      try {
        await TenantProduct.create({
          tenantId,
          productMasterId: m._id,
          price: { mrp: null, sellingPrice: 0, currency: 'INR' }, // tenant sets price after sync
          stockQty: 0,
          status: TENANT_LISTING_STATUS.DRAFT,
          version: 1,
          listedBy: actorId || null,
        });
        created += 1;
      } catch {
        failed += 1;
      }
    }

    await auditService.record({
      action: 'sync_vendor_products', entityType: 'vendor', entityId: vendor._id,
      tenantId, actorId, actorType: 'admin',
      after: { vendorId: vendor._id, created, skipped, failed }, req,
    }).catch(() => {});
    return { vendorId: vendor._id, vendorName: vendor.businessName, mastersScanned: masters.length, created, skipped, failed };
  }

  /** Vendors whose products are in this store. */
  async storeVendors({ tenantId }) {
    const listings = await TenantProduct.find({ tenantId }).select('productMasterId').lean();
    const masterIds = listings.map((l) => l.productMasterId);
    if (!masterIds.length) return [];
    const masters = await ProductMaster.find({ _id: { $in: masterIds }, vendorId: { $ne: null } }).select('vendorId').lean();
    const vendorIds = [...new Set(masters.map((m) => String(m.vendorId)).filter(Boolean))];
    if (!vendorIds.length) return [];
    return serializeList(await Vendor.find({ _id: { $in: vendorIds } }).select('businessName slug city categories status commissionRateBps').lean());
  }

  // ---------------- platform admin: tenant registry ----------------
  async listTenants({ query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = {};
    if (query.status) q.status = query.status;
    if (query.plan) q.plan = query.plan;
    if (query.search) q.$or = [{ name: { $regex: query.search, $options: 'i' } }, { slug: { $regex: query.search, $options: 'i' } }];
    const [docs, total] = await Promise.all([
      Tenant.find(q).select('name slug plan status ownerUserId store createdAt').sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      Tenant.countDocuments(q),
    ]);
    const rows = serializeList(docs);
    const subs = await billingService.subscriptionsForTenants(rows.map((r) => r.id));
    const subByTenant = new Map(subs.map((s) => [String(s.tenantId), s]));
    const items = rows.map((r) => ({ ...r, subscription: subByTenant.get(r.id) || null }));
    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }
}

export default new StoreService();
