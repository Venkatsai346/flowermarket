/**
 * StoreService — tenant self-service + storefront (Phase 5).
 *
 * registerStore(): public self-service — creates Tenant + owner admin user +
 * auth config + trial subscription, returns owner tokens (smooth onboarding).
 * ALL-OR-NOTHING: the identity core commits atomically (one transaction where
 * the topology supports it, compensating cleanup where not), so a mid-flow
 * failure can never orphan a tenant that wedges the slug. Branding/discovery/
 * publish are store-owner ops; syncVendorProducts routes
 * an approved vendor's products into a marketplace-enabled store (idempotent
 * on productMasterId, reusing the Phase-2 TenantProduct listing mechanics).
 */

import mongoose from 'mongoose';
import Tenant from '../models/tenant.model.js';
import TenantAuthConfig from '../models/tenantAuthConfig.model.js';
import TenantSubscription from '../models/tenantSubscription.model.js';
import User from '../models/user.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import Hub from '../models/hub.model.js';
import ServiceablePincode from '../models/serviceablePincode.model.js';
import DeliverySlot from '../models/deliverySlot.model.js';
import DeliveryFeePolicy from '../models/deliveryFeePolicy.model.js';
import TaxPolicy from '../models/taxPolicy.model.js';
import TaxRegistration from '../models/taxRegistration.model.js';
import ProductMaster from '../models/productMaster.model.js';
import Vendor from '../models/vendor.model.js';
import planService from './plan.service.js';
import billingService, { assertTenantSubscriptionSchema } from './billing.service.js';
import auditService from './audit.service.js';
import { transactionsSupported } from '../utils/transactions.js';
import { serializeList } from '../utils/serialize.js';
import { badRequest, conflict, notFound, forbidden } from '../utils/ApiError.js';
import { roundMoney } from '../utils/money.js';
import config from '../config/index.js';
import { USER_ROLES, PRODUCT_MASTER_STATUS, TENANT_LISTING_STATUS, TENANT_STATUS, AUDIT_ACTION } from '../constants/enums.js';
import tenantDomainService from './tenantDomain.service.js';
import slotService from './slot.service.js';
import { BRAND_KITS } from '../constants/brandKits.js';
import { evaluateOnboarding } from '../utils/onboardingReadiness.js';
import { TAX_OWNER_TYPE } from '../constants/enums.js';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class StoreService {
  /**
   * Create a store (public). Idempotent-ish: slug unique → 409 on retry.
   * All-or-nothing: pre-checks fail BEFORE the first write, the identity core
   * (Tenant + auth config + owner + subscription) commits atomically, and only
   * then do the best-effort post-commit steps (skeleton, audit, tokens) run.
   */
  async registerStore({ name, slug, plan = 'free', planCode = null, contactEmail = null, owner = {}, req = null }) {
    if (!SLUG_RE.test(slug)) throw badRequest('Slug must be lowercase letters, numbers, hyphens', 'BAD_SLUG');
    if (config.marketplace.reservedSlugs.includes(slug)) throw conflict('This slug is reserved', 'SLUG_RESERVED');
    const slugTaken = await Tenant.findOne({ slug }).select('_id').lean();
    if (slugTaken) throw conflict('Tenant slug already exists', 'TENANT_SLUG_EXISTS');
    const planDoc = await planService.getActiveByCode(planCode || plan);
    assertTenantSubscriptionSchema();
    const { tenant, ownerUser } = await this.createRegistrationCore({ name, slug, contactEmail, owner, planDoc });

    // ---- operational skeleton (F5) ----
    // A Tenant, an auth config, an owner and a subscription are not a shop: with
    // no hub, no serviceable pincode, no open slot and no fee policy, checkout
    // refuses every customer. Seed the parts that can be defaulted; the parts
    // that cannot (which pincodes the merchant serves) become the first blocking
    // item on the checklist returned below.
    const seeded = await this.seedStarterSkeleton({
      tenant, actorId: ownerUser._id, req,
    }).catch((err) => ({ hub: null, feePolicy: null, slots: 0, errors: [err.message] }));

    await auditService.record({
      action: 'create', entityType: 'tenant', entityId: tenant._id,
      tenantId: tenant._id, actorId: ownerUser._id, actorType: 'tenant',
      after: { slug: tenant.slug, name: tenant.name, plan: planDoc.code, seeded }, req,
    }).catch(() => {});

    const { default: AuthService } = await import('./auth.service.js');
    const tokens = await AuthService.issueTokens(ownerUser);
    // `onboarding` ships with the registration response so the console can render
    // the checklist on the very first screen instead of letting the merchant
    // discover the gap by watching a customer fail to check out.
    return { tenant, owner: ownerUser, tokens, seeded, onboarding: await this.getOnboardingStatus({ tenantId: tenant.id }).catch(() => null) };
  }

  /**
   * Registration identity core, all-or-nothing. Replica set / mongos → one ACID
   * transaction; standalone mongod (local dev, hermetic suites) → ordered writes
   * with reverse-order compensating deletes. Callers cannot tell the difference:
   * success returns the graph, failure leaves NOTHING behind (no orphan tenant
   * wedging the slug, no owner without a store).
   */
  async createRegistrationCore({ name, slug, contactEmail, owner, planDoc }) {
    if (await transactionsSupported()) {
      const session = await mongoose.startSession();
      try {
        let committed = null;
        await session.withTransaction(async () => {
          committed = await this.writeRegistrationCore({ name, slug, contactEmail, owner, planDoc, session, created: null });
        });
        return committed;
      } finally {
        await session.endSession();
      }
    }
    const created = {};
    try {
      return await this.writeRegistrationCore({ name, slug, contactEmail, owner, planDoc, session: null, created });
    } catch (err) {
      await this.compensateRegistration(created);
      throw err;
    }
  }

  /** The core writes, identical on both atomicity paths. Tracks ids for compensation. */
  async writeRegistrationCore({ name, slug, contactEmail, owner, planDoc, session, created = null }) {
    const saveOpts = session ? { session } : undefined;
    const track = (key, id) => { if (created) created[key] = id; };

    let tenant = null;
    try {
      tenant = new Tenant({
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
      await tenant.save(saveOpts);
    } catch (err) {
      // Pre-check passed but the write collided (concurrent double submit): the
      // unique index is the real guard, and it reports the SAME code as the
      // pre-check so clients handle one 409 either way.
      if (err?.code === 11000) throw conflict('Tenant slug already exists', 'TENANT_SLUG_EXISTS');
      throw err;
    }
    track('tenantId', tenant._id);

    // ---- auth config ----
    const authConfig = new TenantAuthConfig({ tenantId: tenant.id });
    await authConfig.save(saveOpts);
    track('authConfigId', authConfig._id);

    // ---- owner admin (NEVER super_admin; token tenant = this new store) ----
    // Identity is UNVERIFIED at registration: claiming an email must never mark
    // it verified (typo/hijack risk). The owner proves it via the verify-email
    // OTP flow, and publishing is blocked until they do (onboarding item).
    const ownerUser = new User({
      tenantId: tenant.id,
      email: owner.email ? { address: String(owner.email).toLowerCase(), verified: false } : { verified: false },
      phone: owner.phone ? { countryCode: '+91', number: owner.phone, verified: false } : { verified: false },
      role: USER_ROLES.ADMIN,
      status: 'active',
      profile: { firstName: (owner.firstName || '').trim() || 'Store', lastName: (owner.lastName || '').trim() || 'Owner' },
      loginMethods: owner.email ? ['email_password'] : ['phone_otp'],
      defaultTenantId: tenant.id,
    });
    await ownerUser.save(saveOpts);
    track('userId', ownerUser._id);
    if (owner.password) {
      await ownerUser.setPassword(owner.password);
      await ownerUser.save(saveOpts);
    }
    tenant.ownerUserId = ownerUser._id;
    await tenant.save(saveOpts);

    // ---- trial subscription (plan pricing snapshot) ----
    const { subscription } = await billingService.ensureSubscription({
      tenantId: tenant._id,
      planCode: planDoc.code,
      commissionRateBps: planDoc.commissionRateBps,
      trialDays: planDoc.trialDays,
      session,
    });
    track('subscriptionId', subscription._id);

    return { tenant, ownerUser, subscription };
  }

  /**
   * Standalone-mongod compensation: delete what the failed core created, in
   * reverse-creation order. Best-effort per row and NEVER throws — compensation
   * must not mask the original error, and one failed delete must not stop the
   * rest. Rows are independent (no FKs), so the deletes run concurrently.
   */
  async compensateRegistration(created) {
    const steps = [
      ['tenant subscription', TenantSubscription, created.subscriptionId],
      ['owner user', User, created.userId],
      ['auth config', TenantAuthConfig, created.authConfigId],
      ['tenant', Tenant, created.tenantId],
    ].filter(([, , id]) => id);
    const settled = await Promise.allSettled(
      steps.map(([label, model, id]) => model.deleteOne({ _id: id }).then(() => label))
    );
    for (const [i, result] of settled.entries()) {
      if (result.status === 'rejected') {
        // A failed compensation is an ops incident (orphan row): loud, with the id.
        // eslint-disable-next-line no-console
        console.warn(`[register] compensation failed for ${steps[i][0]} ${steps[i][2]}: ${result.reason?.message || result.reason}`);
      }
    }
  }

  // ---------------- onboarding (F5) ----------------
  /**
   * Seed the operational skeleton a new store needs before it can take an order.
   *
   * Called at the end of registerStore(). Three things are created, and the
   * choice of what NOT to create matters as much as the rest:
   *
   *   • a Hub — every serviceable pincode must resolve to an active hub, and
   *     every delivery slot belongs to one, so nothing works without it. Its
   *     address is left blank because only the merchant knows it.
   *   • open DeliverySlots for the next few days — slots are generated lazily
   *     elsewhere, but a brand-new store has no cron history and a customer
   *     arriving in the first minute should still see windows to pick from.
   *   • a DeliveryFeePolicy with an EXPLICIT base fee of zero. Before this, a
   *     store with no policy was charged a hardcoded ₹49 by the pricing engine —
   *     a number no merchant chose. Free until they set a real fee is the honest
   *     default, and having the row at all means the admin console has something
   *     to edit instead of a blank page.
   *
   * NOT seeded: serviceable pincodes. A merchant's delivery area is a business
   * fact nobody can guess, and a wrong guess is worse than no guess — it puts a
   * store in front of customers it cannot serve, or claims a city it does not
   * operate in. Pincodes are the first blocking item on the checklist instead.
   *
   * Every step is independently resilient and NONE of them can fail the
   * registration: the tenant, owner and subscription already exist by this
   * point, so aborting would orphan them. A store that seeds badly is still a
   * store the checklist can describe accurately.
   *
   * @returns {Promise<{hub:string|null, feePolicy:string|null, slots:number, errors:string[]}>}
   */
  async seedStarterSkeleton({ tenant, actorId = null, req = null }) {
    const onb = config.onboarding;
    const result = { hub: null, feePolicy: null, slots: 0, errors: [] };
    const tenantId = tenant.id || tenant._id;

    // ---- hub ----
    let hub = null;
    if (onb.seedHub) {
      try {
        hub = await Hub.findOne({ tenantId, isActive: true }).sort({ createdAt: 1 });
        if (!hub) {
          hub = await Hub.create({
            tenantId,
            name: onb.hubName,
            code: onb.hubCode,
            serviceablePincodes: [], // the merchant decides their area
            defaultSlotCapacity: onb.hubSlotCapacity,
            isActive: true,
          });
          await auditService.record({
            action: 'create', entityType: 'hub', entityId: hub._id,
            tenantId, actorId, actorType: 'admin',
            after: { code: hub.code, name: hub.name, seededBy: 'onboarding' }, req,
          }).catch(() => {});
        }
        result.hub = String(hub._id);
      } catch (err) {
        result.errors.push(`hub: ${err.message}`);
      }
    }

    // ---- delivery fee policy ----
    if (onb.seedFeePolicy) {
      try {
        let policy = await DeliveryFeePolicy.findOne({ tenantId, isActive: true }).lean();
        if (!policy) {
          policy = await DeliveryFeePolicy.create({
            tenantId,
            name: 'default',
            baseFee: onb.defaultBaseFee,
            freeDeliveryThreshold: onb.defaultFreeThreshold,
            expressSurgeMultiplier: onb.defaultExpressSurge,
            distanceFeePerKm: 0,
            isActive: true,
            version: 1,
          });
          await auditService.record({
            action: 'create', entityType: 'delivery_fee_policy', entityId: policy._id,
            tenantId, actorId, actorType: 'admin',
            after: { baseFee: policy.baseFee, seededBy: 'onboarding' }, req,
          }).catch(() => {});
        }
        result.feePolicy = String(policy._id);
      } catch (err) {
        result.errors.push(`deliveryFeePolicy: ${err.message}`);
      }
    }

    // ---- delivery slots for the next few days ----
    if (hub) {
      try {
        const iso = (d) => d.toISOString().slice(0, 10);
        const from = new Date();
        const to = new Date(Date.now() + Math.max(0, onb.slotDaysAhead - 1) * 86400000);
        const gen = await slotService.generateForDates({
          tenantId,
          hubId: hub._id,
          fromDate: iso(from),
          toDate: iso(to),
          capacity: onb.hubSlotCapacity,
        });
        result.slots = gen?.created || 0;
      } catch (err) {
        result.errors.push(`slots: ${err.message}`);
      }
    }

    if (result.errors.length) {
      // Loud but not fatal — see the method comment.
      console.warn(`[store] onboarding skeleton incomplete for tenant ${tenantId}: ${result.errors.join('; ')}`);
    }
    return result;
  }

  /**
   * Gather the counts onboarding readiness is decided from.
   *
   * This is the ONLY half that touches the database; the decision itself lives in
   * `utils/onboardingReadiness.js` so it can be tested exhaustively without a
   * mongod. Readiness is deliberately never STORED on the tenant: a persisted
   * flag goes stale the moment a hub is deactivated, a slot window passes, or a
   * product is unpublished, and a stale "ready" is exactly the bug this fixes.
   */
  async collectOnboardingFacts({ tenantId }) {
    const [
      activeHubs,
      serviceablePincodes,
      pincodesWithoutHub,
      upcomingSlots,
      feePolicy,
      activeProducts,
      gstinRow,
    ] = await Promise.all([
      Hub.countDocuments({ tenantId, isActive: true }),
      ServiceablePincode.countDocuments({ tenantId, isServiceable: true, hubId: { $ne: null } }),
      ServiceablePincode.countDocuments({ tenantId, isServiceable: true, hubId: null }),
      // 'YYYY-MM-DD' strings compare lexicographically, which is why the model
      // stores dates that way; today onward, and only slots a customer can book.
      DeliverySlot.countDocuments({
        tenantId,
        date: { $gte: new Date().toISOString().slice(0, 10) },
        status: 'open',
      }),
      DeliveryFeePolicy.findOne({ tenantId, isActive: true }).select('_id').lean(),
      TenantProduct.countDocuments({ tenantId, status: TENANT_LISTING_STATUS.ACTIVE }),
      TaxRegistration.findOne({
        ownerType: TAX_OWNER_TYPE.TENANT,
        ownerId: tenantId,
        status: 'active',
      }).select('gstin').lean().catch(() => null),
    ]);

    // ---- tax-policy coverage over the categories actually in use ----
    // Two cheap queries rather than an aggregation: this endpoint is read on page
    // load, not per request, and the explicit form is easier to reason about.
    let categoriesInUse = 0;
    let categoriesMissingTaxPolicy = 0;
    if (activeProducts > 0) {
      const masterIds = await TenantProduct.distinct('productMasterId', {
        tenantId,
        status: TENANT_LISTING_STATUS.ACTIVE,
      });
      if (masterIds.length) {
        const cats = await ProductMaster.distinct('categoryId', {
          _id: { $in: masterIds },
          categoryId: { $ne: null },
        });
        const catIds = cats.filter(Boolean).map(String);
        categoriesInUse = catIds.length;
        if (catIds.length) {
          const covered = await TaxPolicy.distinct('categoryId', {
            categoryId: { $in: cats.filter(Boolean) },
            isActive: true,
          });
          const coveredSet = new Set(covered.map(String));
          categoriesMissingTaxPolicy = catIds.filter((c) => !coveredSet.has(c)).length;
        }
      }
    }

    const tenant = await Tenant.findById(tenantId).select('store gstin ownerUserId').lean();
    // Legacy grandfather: a tenant with no recorded owner has nobody to verify
    // as — every store created by registerStore DOES have one, so only
    // pre-verification rows take this path, and they stay published.
    let ownerEmailVerified = true;
    if (tenant?.ownerUserId) {
      const owner = await User.findById(tenant.ownerUserId).select('email.verified').lean();
      ownerEmailVerified = Boolean(owner?.email?.verified);
    }

    return {
      activeHubs,
      serviceablePincodes,
      pincodesWithoutHub,
      upcomingSlots,
      hasActiveFeePolicy: Boolean(feePolicy),
      activeProducts,
      categoriesInUse,
      categoriesMissingTaxPolicy,
      tagline: tenant?.store?.tagline || null,
      gstin: gstinRow?.gstin || tenant?.gstin || null,
      ownerEmailVerified,
    };
  }

  /**
   * The onboarding checklist for a store: what exists, what is missing, and
   * whether it may be published.
   */
  async getOnboardingStatus({ tenantId }) {
    const tenant = await Tenant.findById(tenantId).select('store name slug').lean();
    if (!tenant) throw notFound('Store not found', 'STORE_NOT_FOUND');

    const facts = await this.collectOnboardingFacts({ tenantId });
    const evaluation = evaluateOnboarding(facts, {
      requireReadyToPublish: config.onboarding.requireReadyToPublish,
      slotDaysAhead: config.onboarding.slotDaysAhead,
    });

    return {
      store: { id: String(tenant._id), name: tenant.name, slug: tenant.slug },
      isPublished: Boolean(tenant.store?.isPublished),
      onboardingStatus: tenant.store?.onboardingStatus || 'registered',
      ...evaluation,
      facts,
    };
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
      const incoming = { ...(tenant.theme?.toObject?.() || tenant.theme || {}), ...payload.theme };
      if (payload.theme.kit && BRAND_KITS[payload.theme.kit]) {
        const kit = BRAND_KITS[payload.theme.kit];
        if (payload.theme.primaryColor === undefined) incoming.primaryColor = kit.primaryColor;
        if (payload.theme.accentColor === undefined) incoming.accentColor = kit.accentColor;
      }
      tenant.theme = incoming;
    }
    tenant.store = {
      ...(tenant.store || {}),
      tagline: payload.tagline !== undefined ? payload.tagline || null : tenant.store?.tagline || null,
      description: payload.description !== undefined ? payload.description || null : tenant.store?.description || null,
      bannerUrl: payload.bannerUrl !== undefined ? payload.bannerUrl || null : tenant.store?.bannerUrl || null,
      socialLinks: payload.socialLinks ? { ...(tenant.store?.socialLinks || {}), ...payload.socialLinks } : tenant.store?.socialLinks || {},
    };
    if (payload.isPublished !== undefined) {
      const wantsPublish = Boolean(payload.isPublished);
      const alreadyPublished = Boolean(tenant.store?.isPublished);

      // Refuse to put a store in front of customers that cannot serve them.
      // Only checked on the transition into published — unpublishing must always
      // work (that is the emergency stop), and re-saving an already-published
      // store must not fail because a slot window expired overnight.
      if (wantsPublish && !alreadyPublished && config.onboarding.requireReadyToPublish) {
        const facts = await this.collectOnboardingFacts({ tenantId });
        const evaluation = evaluateOnboarding(facts, {
          requireReadyToPublish: true,
          slotDaysAhead: config.onboarding.slotDaysAhead,
        });
        if (!evaluation.canPublish) {
          throw badRequest(
            `This store cannot take orders yet. Finish these first: ${evaluation.reasons.join('; ')}.`,
            'STORE_NOT_READY',
            { blocking: evaluation.blocking, reasons: evaluation.reasons, items: evaluation.items },
          );
        }
      }

      tenant.store.isPublished = wantsPublish;
      if (wantsPublish) tenant.store.onboardingStatus = 'active';
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

  // ---------------- owner email verification ----------------
  /**
   * Send the owner an email-verification OTP (purpose `email_verify`).
   * Any store admin may trigger it; the code always goes to the OWNER's email
   * (tenant.ownerUserId), since that address anchors recovery + invoicing.
   */
  async requestEmailVerify({ tenantId, actorId = null }) {
    const tenant = await Tenant.findById(tenantId).select('ownerUserId').lean();
    if (!tenant?.ownerUserId) throw notFound('Store owner not found', 'OWNER_NOT_FOUND');
    const owner = await User.findOne({ _id: tenant.ownerUserId, tenantId }).select('email').lean();
    const target = owner?.email?.address;
    if (!target) throw badRequest('Owner has no email address to verify', 'NO_OWNER_EMAIL');
    if (owner.email.verified) return { alreadyVerified: true, email: target };
    const { default: OtpService } = await import('./otp.service.js');
    const { default: TenantService } = await import('./tenant.service.js');
    const authCfg = await TenantService.getAuthConfig(tenantId);
    // Pass the OTP result through (not just "sent"): expiresInSeconds lets the
    // UI say when the code dies, and devCode — present ONLY when the console
    // provider echoes it, which production boot refuses — is the only way a
    // dev/laptop env can complete this flow. Auth OTP already returns it
    // verbatim; swallowing it here stranded console-env owners with a "code
    // sent" toast and no code anywhere they could see.
    const otp = await OtpService.request({
      tenantId,
      purpose: 'email_verify',
      channel: 'email',
      target,
      userId: owner._id,
      length: authCfg.otpLength || config.otp.length,
      ttlSeconds: authCfg.otpTtlSeconds || config.otp.ttlSeconds,
      maxAttempts: authCfg.otpMaxAttempts || config.otp.maxAttempts,
    });
    return {
      alreadyVerified: false,
      email: target,
      expiresInSeconds: otp.expiresInSeconds,
      ...(otp.devCode ? { devCode: otp.devCode } : {}),
    };
  }

  /** Confirm the code → owner email verified (unblocks publishing). */
  async confirmEmailVerify({ tenantId, code, actorId = null, req = null }) {
    const tenant = await Tenant.findById(tenantId).select('ownerUserId').lean();
    if (!tenant?.ownerUserId) throw notFound('Store owner not found', 'OWNER_NOT_FOUND');
    const owner = await User.findOne({ _id: tenant.ownerUserId, tenantId });
    const target = owner?.email?.address;
    if (!target) throw badRequest('Owner has no email address to verify', 'NO_OWNER_EMAIL');
    if (owner.email.verified) return { alreadyVerified: true, email: target };
    const { default: OtpService } = await import('./otp.service.js');
    await OtpService.verify({ tenantId, purpose: 'email_verify', channel: 'email', target, code });
    owner.email.verified = true;
    owner.email.verifiedAt = new Date();
    await owner.save();
    await auditService.record({
      action: 'verify', entityType: 'user', entityId: owner._id,
      tenantId, actorId, actorType: 'admin',
      after: { email: target, verified: true }, req,
    }).catch(() => {});
    return { alreadyVerified: false, email: target };
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
        Tenant.find(q).select('name slug plan status statusReason statusChangedAt ownerUserId store createdAt').sort({ createdAt: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      Tenant.countDocuments(q),
    ]);
    const rows = serializeList(docs);
    const subs = await billingService.subscriptionsForTenants(rows.map((r) => r.id));
    const subByTenant = new Map(subs.map((s) => [String(s.tenantId), s]));
    const items = rows.map((r) => ({ ...r, subscription: subByTenant.get(r.id) || null }));
    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  /**
   * Platform kill-switch. Host resolution only serves `active` tenants, so a
   * suspend 404s the storefront immediately (after cache drop). Admin traffic
   * uses the header path and keeps working so operators can still refund.
   */
  async setStatus({ tenantId, status, reason = null, actorId = null, req = null }) {
    const allowed = new Set(Object.values(TENANT_STATUS));
    if (!allowed.has(status)) throw badRequest('Invalid tenant status', 'BAD_TENANT_STATUS');

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw notFound('Store not found', 'STORE_NOT_FOUND');

    const before = { status: tenant.status, reason: tenant.statusReason || null };
    if (tenant.status === status) {
      return { tenant, unchanged: true };
    }

    tenant.status = status;
    tenant.statusReason = reason ? String(reason).slice(0, 500) : null;
    tenant.statusChangedAt = new Date();
    tenant.statusChangedBy = actorId || null;
    await tenant.save({ validateModifiedOnly: true });

    tenantDomainService.invalidateTenant(tenant.slug);
    tenantDomainService.invalidate();

    await auditService.record({
      action: AUDIT_ACTION.STATUS_CHANGE,
      entityType: 'tenant',
      entityId: tenant._id,
      tenantId: tenant._id,
      actorId,
      actorType: 'admin',
      before,
      after: { status: tenant.status, reason: tenant.statusReason },
      req,
    }).catch(() => {});

    return { tenant, unchanged: false };
  }
}

export default new StoreService();
