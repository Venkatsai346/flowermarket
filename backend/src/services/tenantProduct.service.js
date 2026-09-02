import mongoose from 'mongoose';
import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import ProductImage from '../models/productImage.model.js';
import Inventory from '../models/inventory.model.js';
import PriceHistory from '../models/priceHistory.model.js';
import Category from '../models/category.model.js';
import Brand from '../models/brand.model.js';
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import { updateWithVersion } from '../utils/catalog/optimisticLock.js';
import deriveAvailability from '../utils/catalog/availability.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import {
  TENANT_LISTING_STATUS,
  PRODUCT_MASTER_STATUS,
  PRICE_CHANGE_REASON,
  PRICE_CHANGE_SOURCE,
} from '../constants/enums.js';

/**
 * TenantProductService — tenant-scoped sellable listings.
 *
 * Tenant fields (price, stock, status) are written DIRECTLY by the tenant
 * with optimistic locking; global fields are NOT accepted here.
 */
class TenantProductService {
  async createListing({ tenantId, payload, actorId = null, req = null }) {
    const master = await ProductMaster.findById(payload.productMasterId);
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    if (![PRODUCT_MASTER_STATUS.ACTIVE, PRODUCT_MASTER_STATUS.PENDING_REVIEW].includes(master.status)) {
      throw badRequest('Master is not available for listing', 'MASTER_NOT_AVAILABLE');
    }

    const variantId = payload.variantId || null;
    const existing = await TenantProduct.findOne({ tenantId, productMasterId: master.id, variantId });
    if (existing) throw conflict('A listing already exists for this product', 'LISTING_EXISTS');

    if (payload.price && payload.price.sellingPrice != null && payload.price.mrp != null) {
      this.assertPriceValid(payload.price);
    }

    const listing = await TenantProduct.create({
      tenantId,
      productMasterId: master.id,
      variantId,
      price: payload.price || { mrp: null, sellingPrice: null },
      orderLimits: payload.orderLimits || {},
      stockQty: payload.stockQty || 0,
      status: payload.status || TENANT_LISTING_STATUS.DRAFT,
      listedBy: actorId,
      availability: {
        status: deriveAvailability(payload.stockQty || 0),
        updatedAt: new Date(),
      },
      lastStatusChangedAt: payload.status ? new Date() : null,
    });

    if ((payload.stockQty || 0) > 0) {
      await Inventory.create({
        tenantId,
        tenantProductId: listing.id,
        qtyOnHand: payload.stockQty,
        lastUpdatedAt: new Date(),
      });
    }

    await auditService.record({
      action: 'create', entityType: 'tenant_product', entityId: listing.id,
      tenantId, actorId, actorType: 'tenant',
      after: { masterId: master.id, price: listing.price, status: listing.status, stockQty: listing.stockQty }, req,
    });
    await catalogEventService.publish({
      eventType: 'tenant_product_created', entityType: 'tenant_product', entityId: listing.id,
      tenantId, payload: { id: listing.id, masterId: master.id, status: listing.status },
    });
    return listing;
  }

  async getListing({ tenantId, listingId }) {
    const listing = await TenantProduct.findOne({ _id: listingId, tenantId });
    if (!listing) throw notFound('Listing not found', 'LISTING_NOT_FOUND');
    return listing;
  }

  async updatePrice({ tenantId, listingId, price, expectedVersion, actorId = null, reason = PRICE_CHANGE_REASON.MANUAL, source = PRICE_CHANGE_SOURCE.TENANT, req = null }) {
    const listing = await this.getListing({ tenantId, listingId });
    this.assertPriceValid(price);
    const before = listing.price.toObject();
    await updateWithVersion(listing, expectedVersion, { price, lastPriceChangedAt: new Date() });

    await PriceHistory.create({
      tenantId, tenantProductId: listing.id,
      before: { mrp: before.mrp, sellingPrice: before.sellingPrice },
      after: { mrp: price.mrp, sellingPrice: price.sellingPrice },
      currency: price.currency || 'INR',
      reason, source, changedBy: actorId,
    });

    await auditService.record({
      action: 'price_change', entityType: 'tenant_product', entityId: listing.id,
      tenantId, actorId, actorType: 'tenant',
      before: { mrp: before.mrp, sellingPrice: before.sellingPrice },
      after: { mrp: price.mrp, sellingPrice: price.sellingPrice },
      meta: { reason }, req,
    });
    await catalogEventService.publish({
      eventType: 'price_changed', entityType: 'tenant_product', entityId: listing.id,
      tenantId, payload: { id: listing.id, price, reason },
    });
    return listing;
  }

  async updateStatus({ tenantId, listingId, status, expectedVersion, actorId = null, req = null }) {
    const listing = await this.getListing({ tenantId, listingId });
    this.assertTransition(listing, status);

    await updateWithVersion(listing, expectedVersion, { status, lastStatusChangedAt: new Date() });

    await auditService.record({
      action: 'status_change', entityType: 'tenant_product', entityId: listing.id,
      tenantId, actorId, actorType: 'tenant',
      before: { status: listing.status }, after: { status }, req,
    });
    const eventType = status === TENANT_LISTING_STATUS.INACTIVE ? 'product_deactivated' : 'tenant_product_updated';
    await catalogEventService.publish({
      eventType, entityType: 'tenant_product', entityId: listing.id,
      tenantId, payload: { id: listing.id, status },
    });
    return listing;
  }

  async deactivate({ tenantId, listingId, expectedVersion, actorId = null, req = null }) {
    return this.updateStatus({ tenantId, listingId, status: TENANT_LISTING_STATUS.INACTIVE, expectedVersion, actorId, req });
  }

  async listListings({ tenantId, query = {} } = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    // aggregate pipelines do NOT auto-cast ids — normalize to ObjectId
    const tid = tenantId instanceof mongoose.Types.ObjectId ? tenantId : new mongoose.Types.ObjectId(tenantId);
    const match = { tenantId: tid, isDeleted: { $ne: true } };
    if (query.status) match.status = query.status;

    const pipeline = [{ $match: match }];
    pipeline.push({
      $lookup: {
        from: 'productmasters',
        localField: 'productMasterId',
        foreignField: '_id',
        as: 'master',
      },
    });
    pipeline.push({ $unwind: { path: '$master', preserveNullAndEmptyArrays: false } });

    if (query.search) {
      const rx = new RegExp(query.search, 'i');
      pipeline.push({ $match: { $or: [{ 'master.title': rx }, { 'master.searchText': rx }] } });
    }
    if (query.categoryId) pipeline.push({ $match: { 'master.categoryId': query.categoryId } });
    if (query.brandId) pipeline.push({ $match: { 'master.brandId': query.brandId } });
    if (query.minPrice !== undefined) pipeline.push({ $match: { 'price.sellingPrice': { $gte: Number(query.minPrice) } } });
    if (query.maxPrice !== undefined) pipeline.push({ $match: { 'price.sellingPrice': { $lte: Number(query.maxPrice) } } });

    const [items, total] = await Promise.all([
      (async () => {
        const arr = await TenantProduct.aggregate([
          ...pipeline,
          { $sort: { createdAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $project: {
              id: 1, tenantId: 1, productMasterId: 1, variantId: 1, price: 1, orderLimits: 1,
              stockQty: 1, availability: 1, status: 1, version: 1, createdAt: 1, updatedAt: 1,
              master: {
                id: '$master._id', title: '$master.title', slug: '$master.slug',
                skuGlobal: '$master.skuGlobal', type: '$master.type',
                categoryId: '$master.categoryId', brandId: '$master.brandId',
                isPerishable: '$master.isPerishable', defaultSellingUnit: '$master.defaultSellingUnit',
                status: '$master.status',
              },
            },
          },
        ]);
        return arr;
      })(),
      TenantProduct.aggregate([...pipeline, { $count: 'total' }]).then((r) => r[0]?.total ?? 0),
    ]);

    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + items.length < total } };
  }

  /** Master detail with listing context (used by tenant dashboard). */
  async getListingDetail({ tenantId, listingId }) {
    const listing = await this.getListing({ tenantId, listingId });
    const [master, images] = await Promise.all([
      ProductMaster.findById(listing.productMasterId).lean(),
      ProductImage.find({ productMasterId: listing.productMasterId, status: 'active' }).sort({ isPrimary: -1, sortOrder: 1 }).lean(),
    ]);
    return {
      listing: listing.toObject(),
      master: master ? { id: master._id, title: master.title, slug: master.slug, skuGlobal: master.skuGlobal, type: master.type, description: master.description, isPerishable: master.isPerishable, defaultSellingUnit: master.defaultSellingUnit, status: master.status } : null,
      images: images.map((i) => ({ id: i._id, url: i.url, altText: i.altText, isPrimary: i.isPrimary })),
    };
  }

  async masterOfListing({ tenantId, listingId }) {
    const listing = await this.getListing({ tenantId, listingId });
    return ProductMaster.findById(listing.productMasterId);
  }

  // ---------------- helpers ----------------

  assertPriceValid(price) {
    if (price.sellingPrice != null && price.mrp != null && Number(price.sellingPrice) > Number(price.mrp)) {
      throw badRequest('sellingPrice cannot exceed mrp', 'PRICE_INVALID');
    }
  }

  assertTransition(listing, next) {
    const cur = listing.status;
    if (cur === next) return;
    const allowed = {
      [TENANT_LISTING_STATUS.DRAFT]: [TENANT_LISTING_STATUS.ACTIVE, TENANT_LISTING_STATUS.INACTIVE],
      [TENANT_LISTING_STATUS.ACTIVE]: [TENANT_LISTING_STATUS.INACTIVE, TENANT_LISTING_STATUS.OUT_OF_STOCK],
      [TENANT_LISTING_STATUS.INACTIVE]: [TENANT_LISTING_STATUS.ACTIVE],
      [TENANT_LISTING_STATUS.OUT_OF_STOCK]: [TENANT_LISTING_STATUS.ACTIVE, TENANT_LISTING_STATUS.INACTIVE],
    };
    if (!(allowed[cur] || []).includes(next)) {
      throw badRequest(`Cannot transition listing from ${cur} to ${next}`, 'INVALID_STATUS_TRANSITION');
    }
  }
}

export default new TenantProductService();
