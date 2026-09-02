/**
 * VendorService — vendor onboarding, products, stats (Phase 5).
 *
 * apply() → review() (approve = create `vendors` + grant `vendor` role — the
 * ONLY way that role is granted) → vendor products (ProductMaster with
 * vendorId, status pending_review) → platform admin review →
 * marketplaceListed → store sync routes them into marketplace-enabled stores.
 * Vendor stats (gmv/orders) come from `orderitems.vendorId` snapshots — no
 * joins at read time.
 */

import VendorApplication from '../models/vendorApplication.model.js';
import Vendor from '../models/vendor.model.js';
import ProductMaster from '../models/productMaster.model.js';
import OrderItem from '../models/orderItem.model.js';
import User from '../models/user.model.js';
import auditService from './audit.service.js';
import { serializeList } from '../utils/serialize.js';
import { slugify } from '../utils/slugify.js';
import { badRequest, conflict, notFound, forbidden } from '../utils/ApiError.js';
import { roundMoney } from '../utils/money.js';
import config from '../config/index.js';
import {
  VENDOR_APPLICATION_STATUS,
  VENDOR_STATUS,
  USER_ROLES,
  PRODUCT_MASTER_STATUS,
} from '../constants/enums.js';

class VendorService {
  // ---------------- applications ----------------
  async apply({ userId, payload, req = null }) {
    // a user who is already a vendor cannot re-apply
    const existingVendor = await Vendor.findOne({ userId });
    if (existingVendor) throw conflict('You are already a vendor', 'ALREADY_VENDOR');

    const existing = await VendorApplication.findOne({ userId });
    if (existing) {
      if (existing.status === VENDOR_APPLICATION_STATUS.APPROVED) throw conflict('Application already approved', 'ALREADY_APPROVED');
      // re-submit updates the same row
      existing.businessName = payload.businessName;
      existing.slug = payload.slug || existing.slug;
      existing.contactPhone = payload.contactPhone || existing.contactPhone;
      existing.gstin = payload.gstin || existing.gstin;
      existing.categories = payload.categories || existing.categories;
      existing.city = payload.city || existing.city;
      existing.status = VENDOR_APPLICATION_STATUS.SUBMITTED;
      existing.reviewedBy = null;
      existing.reviewedAt = null;
      existing.note = null;
      existing.submittedAt = new Date();
      await existing.save();
      return { application: existing, reSubmitted: true };
    }

    const application = await VendorApplication.create({
      userId,
      businessName: payload.businessName,
      slug: payload.slug || slugify(payload.businessName, { max: 60 }),
      contactPhone: payload.contactPhone || null,
      gstin: payload.gstin || null,
      categories: payload.categories || [],
      city: payload.city || null,
      status: VENDOR_APPLICATION_STATUS.SUBMITTED,
      submittedAt: new Date(),
    });
    await auditService.record({
      action: 'create', entityType: 'vendor_application', entityId: application._id,
      tenantId: null, actorId: userId, actorType: 'vendor',
      after: { businessName: application.businessName }, req,
    }).catch(() => {});
    return { application, reSubmitted: false };
  }

  async listApplications({ query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = {};
    if (query.status) q.status = query.status;
    const [docs, total] = await Promise.all([
      VendorApplication.find(q).sort({ submittedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      VendorApplication.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  /** Platform admin review: approve → vendor profile + `vendor` role. */
  async reviewApplication({ applicationId, decision, note = null, reviewerId = null, req = null }) {
    if (!['approve', 'reject'].includes(decision)) throw badRequest('decision must be approve or reject', 'BAD_DECISION');
    const application = await VendorApplication.findById(applicationId);
    if (!application) throw notFound('Vendor application not found', 'APPLICATION_NOT_FOUND');
    if (application.status === VENDOR_APPLICATION_STATUS.APPROVED && decision === 'approve') {
      return { application, vendor: await Vendor.findOne({ userId: application.userId }), alreadyApproved: true };
    }

    application.status = decision === 'approve' ? VENDOR_APPLICATION_STATUS.APPROVED : VENDOR_APPLICATION_STATUS.REJECTED;
    application.reviewedBy = reviewerId || null;
    application.reviewedAt = new Date();
    application.note = note || null;
    await application.save();

    let vendor = null;
    if (decision === 'approve') {
      const user = await User.findById(application.userId);
      if (!user) throw notFound('User not found', 'USER_NOT_FOUND');

      const slug = application.slug || slugify(application.businessName, { max: 60 });
      const existingBySlug = await Vendor.findOne({ slug });
      if (existingBySlug && String(existingBySlug.userId) !== String(application.userId)) {
        application.status = VENDOR_APPLICATION_STATUS.REJECTED;
        application.note = 'Vendor slug already taken';
        await application.save();
        throw conflict('Vendor slug already taken', 'VENDOR_SLUG_EXISTS');
      }

      vendor = await Vendor.create({
        userId: application.userId,
        businessName: application.businessName,
        slug,
        gstin: application.gstin || null,
        categories: application.categories || [],
        city: application.city || null,
        commissionRateBps: config.marketplace.defaultCommissionBps,
        status: VENDOR_STATUS.ACTIVE,
        joinedAt: new Date(),
        reviewedBy: reviewerId || null,
      });
      // grant the vendor role (only path)
      if (user.role !== USER_ROLES.VENDOR) {
        user.role = USER_ROLES.VENDOR;
        await user.save();
      }
    }

    await auditService.record({
      action: decision, entityType: 'vendor_application', entityId: application._id,
      tenantId: null, actorId: reviewerId, actorType: 'admin',
      before: { status: decision === 'approve' ? VENDOR_APPLICATION_STATUS.SUBMITTED : VENDOR_APPLICATION_STATUS.UNDER_REVIEW },
      after: { status: application.status, vendorId: vendor?._id || null, note }, req,
    }).catch(() => {});
    return { application, vendor };
  }

  // ---------------- vendor profile ----------------
  async profileForUser({ userId }) {
    const vendor = await Vendor.findOne({ userId });
    if (!vendor) throw notFound('Vendor profile not found — apply and get approved first', 'VENDOR_NOT_FOUND');
    const stats = await this.vendorStats({ vendorId: vendor._id });
    return { ...vendor.toJSON(), stats };
  }

  async updateProfile({ userId, payload, req = null }) {
    const vendor = await Vendor.findOne({ userId });
    if (!vendor) throw notFound('Vendor profile not found', 'VENDOR_NOT_FOUND');
    if (payload.businessName) vendor.businessName = payload.businessName;
    if (payload.city !== undefined) vendor.city = payload.city || null;
    if (payload.categories !== undefined) vendor.categories = payload.categories || [];
    if (payload.gstin !== undefined) vendor.gstin = payload.gstin || null;
    if (payload.payout !== undefined) {
      vendor.payout = {
        method: payload.payout.method || 'upi',
        name: payload.payout.name || vendor.payout?.name || null,
        maskedAccount: payload.payout.maskedAccount || vendor.payout?.maskedAccount || null,
      };
    }
    await vendor.save();
    await auditService.record({
      action: 'update', entityType: 'vendor', entityId: vendor._id,
      tenantId: null, actorId: userId, actorType: 'vendor',
      after: { businessName: vendor.businessName }, req,
    }).catch(() => {});
    return vendor;
  }

  // ---------------- vendor products ----------------
  async listMyProducts({ userId, query = {} }) {
    const vendor = await Vendor.findOne({ userId });
    if (!vendor) throw notFound('Vendor profile not found', 'VENDOR_NOT_FOUND');
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = { vendorId: vendor._id };
    if (query.status) q.status = query.status;
    const [docs, total] = await Promise.all([
      ProductMaster.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ProductMaster.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async createProduct({ userId, payload }) {
    const vendor = await Vendor.findOne({ userId });
    if (!vendor) throw notFound('Vendor profile not found', 'VENDOR_NOT_FOUND');
    if (vendor.status !== VENDOR_STATUS.ACTIVE) throw forbidden('Vendor is suspended', 'VENDOR_SUSPENDED');

    const sku = (payload.skuGlobal || '').trim().toUpperCase();
    if (!sku) throw badRequest('skuGlobal is required', 'SKU_REQUIRED');
    const existing = await ProductMaster.findOne({ skuGlobal: sku });
    if (existing) throw conflict('SKU already exists', 'SKU_EXISTS');

    const master = await ProductMaster.create({
      tenantId: null, // platform-shared master catalog
      categoryId: payload.categoryId,
      brandId: payload.brandId || null,
      skuGlobal: sku,
      type: payload.type,
      title: payload.title,
      slug: slugify(payload.title, { max: 90 }),
      shortDescription: payload.shortDescription || null,
      description: payload.description || null,
      tags: payload.tags || [],
      isPerishable: payload.isPerishable === true,
      minOrderQty: payload.minOrderQty || 1,
      maxOrderQty: payload.maxOrderQty || 100,
      status: PRODUCT_MASTER_STATUS.PENDING_REVIEW,
      vendorId: vendor._id,
      marketplaceListed: false,
      createdBy: userId,
    });
    master.searchText = await (await import('./productMaster.service.js')).default.buildSearchText(master);
    await master.save();
    await auditService.record({
      action: 'create', entityType: 'product_master', entityId: master._id,
      tenantId: null, actorId: userId, actorType: 'vendor',
      after: { sku: master.skuGlobal, title: master.title, status: master.status },
    }).catch(() => {});
    return master;
  }

  async updateProduct({ userId, productId, payload }) {
    const vendor = await Vendor.findOne({ userId });
    if (!vendor) throw notFound('Vendor profile not found', 'VENDOR_NOT_FOUND');
    const master = await ProductMaster.findOne({ _id: productId, vendorId: vendor._id });
    if (!master) throw notFound('Product not found', 'PRODUCT_NOT_FOUND');
    if (master.status !== PRODUCT_MASTER_STATUS.PENDING_REVIEW) {
      throw badRequest('Only pending products can be edited', 'PRODUCT_LOCKED');
    }
    for (const k of ['title', 'shortDescription', 'description', 'tags', 'brandId', 'isPerishable', 'minOrderQty', 'maxOrderQty']) {
      if (k in payload) master[k] = payload[k];
    }
    await master.save();
    return master;
  }

  /** Platform admin review of a vendor product → marketplaceListed. */
  async reviewProduct({ productId, decision, note = null, reviewerId = null, req = null }) {
    if (!['approve', 'reject'].includes(decision)) throw badRequest('decision must be approve or reject', 'BAD_DECISION');
    const master = await ProductMaster.findById(productId);
    if (!master || !master.vendorId) throw notFound('Vendor product not found', 'PRODUCT_NOT_FOUND');

    const before = { status: master.status, marketplaceListed: master.marketplaceListed };
    if (decision === 'approve') {
      master.status = PRODUCT_MASTER_STATUS.ACTIVE;
      master.marketplaceListed = true;
      master.marketplaceListedAt = new Date();
    } else {
      master.status = PRODUCT_MASTER_STATUS.REJECTED;
      master.marketplaceListed = false;
    }
    master.review = {
      status: decision === 'approve' ? 'approved' : 'rejected',
      reviewedBy: reviewerId || null,
      reviewedAt: new Date(),
      note: note || null,
    };
    await master.save();
    await auditService.record({
      action: decision, entityType: 'product_master', entityId: master._id,
      tenantId: null, actorId: reviewerId, actorType: 'admin',
      before, after: { status: master.status, marketplaceListed: master.marketplaceListed, note }, req,
    }).catch(() => {});
    return master;
  }

  // ---------------- stats ----------------
  async vendorStats({ vendorId }) {
    const [agg] = await OrderItem.aggregate([
      { $match: { vendorId, isDeleted: { $ne: true } } },
      { $group: { _id: null, gmv: { $sum: '$lineTotal' }, orders: { $sum: 1 } } },
    ]);
    return { gmv: roundMoney(agg?.gmv || 0), orders: agg?.orders || 0, commissionRateBps: null };
  }

  // ---------------- platform admin registry ----------------
  async listVendors({ query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = {};
    if (query.status) q.status = query.status;
    if (query.search) q.$or = [{ businessName: { $regex: query.search, $options: 'i' } }, { slug: { $regex: query.search, $options: 'i' } }];
    const [docs, total] = await Promise.all([
      Vendor.find(q).sort({ joinedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Vendor.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async vendorDetail({ vendorId }) {
    const vendor = await Vendor.findOne({ _id: vendorId });
    if (!vendor) throw notFound('Vendor not found', 'VENDOR_NOT_FOUND');
    const stats = await this.vendorStats({ vendorId });
    const products = await ProductMaster.find({ vendorId }).select('_id skuGlobal title status marketplaceListed createdAt').lean();
    return { ...vendor.toJSON(), stats: { ...stats, commissionRateBps: vendor.commissionRateBps }, products: serializeList(products) };
  }

  async updateVendor({ vendorId, payload, actorId = null, req = null }) {
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) throw notFound('Vendor not found', 'VENDOR_NOT_FOUND');
    const before = { status: vendor.status, commissionRateBps: vendor.commissionRateBps };
    if (payload.commissionRateBps !== undefined) vendor.commissionRateBps = payload.commissionRateBps;
    if (payload.status !== undefined) {
      if (!Object.values(VENDOR_STATUS).includes(payload.status)) throw badRequest('Invalid vendor status', 'BAD_STATUS');
      vendor.status = payload.status;
    }
    await vendor.save();
    await auditService.record({
      action: 'update', entityType: 'vendor', entityId: vendor._id,
      tenantId: null, actorId, actorType: 'admin', before, after: { status: vendor.status, commissionRateBps: vendor.commissionRateBps }, req,
    }).catch(() => {});
    return vendor;
  }
}

export default new VendorService();
