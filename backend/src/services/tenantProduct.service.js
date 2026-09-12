import mongoose from 'mongoose';
import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import ProductVariant from '../models/productVariant.model.js';
import ProductImage from '../models/productImage.model.js';
import Inventory from '../models/inventory.model.js';
import PriceHistory from '../models/priceHistory.model.js';
import Category from '../models/category.model.js';
import Brand from '../models/brand.model.js';
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import { updateWithVersion } from '../utils/catalog/optimisticLock.js';
import deriveAvailability from '../utils/catalog/availability.js';
import { attachVariantGalleries, groupImagesByVariant, sortGallery } from '../utils/catalog/variantImages.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import {
  TENANT_LISTING_STATUS,
  PRICE_CHANGE_REASON,
  PRICE_CHANGE_SOURCE,
  ENTITY_STATUS,
} from '../constants/enums.js';
import { assertMasterListable } from '../utils/catalogGuards.js';

/**
 * TenantProductService — tenant-scoped sellable listings.
 *
 * Tenant fields (price, stock, status) are written DIRECTLY by the tenant
 * with optimistic locking; global fields are NOT accepted here.
 *
 * VARIANT LISTING MODEL (one row per sellable SKU):
 *   (tenantId, productMasterId, variantId) is UNIQUE. variantId == null is the
 *   master-level listing (products without variants, or a tenant that wants one
 *   price for the whole product). A polo with 5 color variants lists as:
 *     case 1 (one variant)  -> 1 row  (variantId = white)
 *     case 2 (some)         -> k rows (variantId in {white, red})
 *     case 3 (all)          -> 5 rows (one per variant)
 *   `bulkCreateListings()` creates the set in one call with per-variant prices;
 *   `masterListingStatus()` powers the selection grid (which variants are
 *   already listed, at what price/stock).
 */
class TenantProductService {
  /** A variant may be listed only if it belongs to the master and is active. */
  async assertVariantListable(masterId, variantId) {
    if (!variantId) return null;
    const variant = await ProductVariant.findOne({ _id: variantId, productMasterId: masterId });
    if (!variant) throw badRequest('Variant does not belong to this product', 'VARIANT_MISMATCH');
    if (variant.status !== ENTITY_STATUS.ACTIVE) {
      throw badRequest(`Variant "${variant.value}" is not active`, 'VARIANT_NOT_AVAILABLE');
    }
    return variant;
  }

  async createListing({ tenantId, payload, actorId = null, req = null }) {
    const master = await ProductMaster.findById(payload.productMasterId);
    assertMasterListable(master);

    const variantId = payload.variantId || null;
    await this.assertVariantListable(master.id, variantId);
    const existing = await TenantProduct.findOne({ tenantId, productMasterId: master.id, variantId });
    if (existing) throw conflict('A listing already exists for this product', 'LISTING_EXISTS');

    if (payload.price && payload.price.sellingPrice != null && payload.price.mrp != null) {
      this.assertPriceValid(payload.price);
    }

    // Plan entitlement: the products cap counts ACTIVE listings. Drafts are
    // always creatable (merchants stage freely); the cap bites on activation.
    // Bulk inherits this per row — excess rows land in `skipped`, never 402
    // the whole batch (see bulkCreateListings partial-success contract).
    if ((payload.status || TENANT_LISTING_STATUS.DRAFT) === TENANT_LISTING_STATUS.ACTIVE) {
      const { default: entitlementService } = await import('./entitlement.service.js');
      await entitlementService.assertWithinLimit({ tenantId, resource: 'products' });
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

  /**
   * List MULTIPLE variants of one master in a single call, each with its own
   * price/stock/status — the "case 1/2/3" bulk path behind the listing wizard.
   *
   * @param {string} productMasterId
   * @param {Array} selections [{ variantId|null, price, stockQty, status, orderLimits }]
   *   — OR — { selectAll: true, defaults: { price, stockQty, status } } for case 3.
   * @param {string} onConflict 'skip' (default) | 'error' — what to do when a
   *   listing already exists for a selected variant. 'skip' makes the wizard
   *   idempotent (re-submitting never duplicates); 'error' fails fast for API users.
   * @returns {{ created: [...], skipped: [...], warnings: [...] }}
   *
   * Each selection is validated independently; a bad row fails ONLY that row
   * (reported in `skipped` with a reason) so one typo never blocks 19 good ones.
   */
  async bulkCreateListings({ tenantId, productMasterId, selections = [], selectAll = false, defaults = {}, onConflict = 'skip', actorId = null, req = null }) {
    const master = await ProductMaster.findById(productMasterId);
    assertMasterListable(master);

    let rows = Array.isArray(selections) ? [...selections] : [];
    if (selectAll) {
      const variants = await ProductVariant.find({ productMasterId: master.id, status: ENTITY_STATUS.ACTIVE })
        .sort({ sortOrder: 1 }).select('_id').lean();
      if (!variants.length) {
        // No variants on the master: select-all means the master-level row.
        rows = [{ variantId: null, ...(defaults || {}) }];
      } else {
        rows = variants.map((v) => ({ variantId: String(v._id), ...(defaults || {}) }));
      }
    }
    if (!rows.length) throw badRequest('Select at least one variant to list', 'NO_SELECTION');
    if (rows.length > 100) throw badRequest('At most 100 variants per bulk request', 'BULK_TOO_LARGE');

    // Duplicate variantIds inside one request are always a client bug.
    const seen = new Set();
    for (const r of rows) {
      const k = r.variantId ? String(r.variantId) : 'master';
      if (seen.has(k)) throw badRequest('Duplicate variant in selection', 'DUPLICATE_SELECTION', { variantId: r.variantId || null });
      seen.add(k);
    }

    const created = [];
    const skipped = [];
    const warnings = [];

    // Mixing a master-level row with variant rows for the same master is legal
    // (legacy stores did it before variants existed) but ambiguous on the
    // storefront — the grouped views prefer variant rows when any exist. Warn.
    const wantsMasterRow = rows.some((r) => !r.variantId);
    const wantsVariantRows = rows.some((r) => r.variantId);
    if (wantsMasterRow && wantsVariantRows) {
      warnings.push({
        code: 'MIXED_MASTER_AND_VARIANT',
        message: 'Listing the master AND its variants: storefront groups will show the variant rows.',
      });
    }

    // Sequential on purpose: partial success with per-row results, and
    // onConflict=error aborts on the FIRST failure (earlier rows stay created).
    for (const row of rows) {
      const variantId = row.variantId || null;
      try {
        // sequential on purpose: each row needs its own validation result
        // eslint-disable-next-line no-await-in-loop
        await this.assertVariantListable(master.id, variantId);
        if (row.price) this.assertPriceValid(row.price);
        // sequential on purpose: abort on first error, earlier rows stay created
        // eslint-disable-next-line no-await-in-loop
        const listing = await this.createListing({
          tenantId,
          payload: {
            productMasterId: master.id,
            variantId,
            price: row.price || { mrp: null, sellingPrice: null },
            stockQty: row.stockQty ?? 0,
            status: row.status || TENANT_LISTING_STATUS.DRAFT,
            orderLimits: row.orderLimits || {},
          },
          actorId,
          req,
        });
        created.push(listing);
      } catch (err) {
        if (err?.code === 'LISTING_EXISTS' && onConflict === 'skip') {
          skipped.push({ variantId, reason: 'already_listed' });
          continue;
        }
        if (onConflict === 'error') throw err;
        skipped.push({ variantId, reason: err?.code || 'INVALID', message: err?.message });
      }
    }

    return { created, skipped, warnings };
  }

  /**
   * The variant-selection grid for ONE master in THIS tenant: every active
   * variant with its resolved gallery, plus the existing listing (if any) with
   * live price/stock/status — so the wizard can check boxes and show
   * "already listed · ₹499 · active" without N round trips.
   */
  async masterListingStatus({ tenantId, masterId }) {
    const master = await ProductMaster.findById(masterId).lean();
    if (!master) throw notFound('Product master not found', 'PRODUCT_MASTER_NOT_FOUND');
    const [variants, images, listings] = await Promise.all([
      ProductVariant.find({ productMasterId: masterId, status: ENTITY_STATUS.ACTIVE }).sort({ sortOrder: 1 }).lean(),
      ProductImage.find({ productMasterId: masterId, status: ENTITY_STATUS.ACTIVE }).sort({ isPrimary: -1, sortOrder: 1 }).lean(),
      TenantProduct.find({ tenantId, productMasterId: masterId }).lean(),
    ]);
    const withGalleries = attachVariantGalleries(variants, images);
    const listingByVariant = new Map();
    let masterListing = null;
    for (const l of listings) {
      if (l.variantId) listingByVariant.set(String(l.variantId), l);
      else masterListing = l;
    }
    return {
      master: {
        id: master._id, title: master.title, slug: master.slug, skuGlobal: master.skuGlobal,
        type: master.type, status: master.status, defaultSellingUnit: master.defaultSellingUnit,
        images: sortGallery(groupImagesByVariant(images).master).map((g) => ({
          id: g._id, url: g.url, altText: g.altText, isPrimary: g.isPrimary,
        })),
      },
      masterListing: masterListing ? {
        id: masterListing._id, price: masterListing.price, stockQty: masterListing.stockQty,
        status: masterListing.status, version: masterListing.version,
      } : null,
      variants: withGalleries.map((v) => {
        const listing = listingByVariant.get(String(v._id)) || null;
        return {
          variant: {
            id: v._id, variantType: v.variantType, value: v.value,
            displayLabel: v.displayLabel, sku: v.sku, sortOrder: v.sortOrder,
            isDefault: v.isDefault, status: v.status,
            images: v.images, imageSource: v.imageSource, primaryImageUrl: v.primaryImageUrl,
          },
          listing: listing ? {
            id: listing._id, price: listing.price, stockQty: listing.stockQty,
            availability: listing.availability, status: listing.status, version: listing.version,
          } : null,
        };
      }),
    };
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

    // Activating past the plan's products cap is a 402 (deactivations always pass).
    if (status === TENANT_LISTING_STATUS.ACTIVE && listing.status !== TENANT_LISTING_STATUS.ACTIVE) {
      const { default: entitlementService } = await import('./entitlement.service.js');
      await entitlementService.assertWithinLimit({ tenantId, resource: 'products' });
      // No zombie listings: a master deprecated (or rejected) after the
      // listing was staged must fail ACTIVATION loudly (409) instead of
      // producing an active-but-invisible, unpurchasable listing. Same rule
      // as creation — ACTIVE or PENDING_REVIEW (staged) only.
      const master = await ProductMaster.findById(listing.productMasterId).select('status').lean();
      assertMasterListable(master);
    }

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
    // Variant context per row (null for master-level listings).
    pipeline.push({
      $lookup: {
        from: 'productvariants',
        localField: 'variantId',
        foreignField: '_id',
        as: 'variant',
      },
    });
    pipeline.push({ $unwind: { path: '$variant', preserveNullAndEmptyArrays: true } });

    if (query.search) {
      const rx = new RegExp(query.search, 'i');
      pipeline.push({ $match: { $or: [{ 'master.title': rx }, { 'master.searchText': rx }] } });
    }
    if (query.categoryId) pipeline.push({ $match: { 'master.categoryId': query.categoryId } });
    if (query.brandId) pipeline.push({ $match: { 'master.brandId': query.brandId } });
    if (query.productMasterId) {
      try {
        pipeline.push({ $match: { productMasterId: new mongoose.Types.ObjectId(query.productMasterId) } });
      } catch { /* invalid id -> no rows, not a 500 */ pipeline.push({ $match: { _id: null } }); }
    }
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
              variant: {
                $cond: [
                  { $ifNull: ['$variant._id', false] },
                  {
                    id: '$variant._id', variantType: '$variant.variantType', value: '$variant.value',
                    displayLabel: '$variant.displayLabel', sku: '$variant.sku',
                    sortOrder: '$variant.sortOrder', isDefault: '$variant.isDefault',
                    status: '$variant.status',
                  },
                  null,
                ],
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
    const [master, images, variant, siblings] = await Promise.all([
      ProductMaster.findById(listing.productMasterId).lean(),
      ProductImage.find({ productMasterId: listing.productMasterId, status: 'active' }).sort({ isPrimary: -1, sortOrder: 1 }).lean(),
      listing.variantId ? ProductVariant.findById(listing.variantId).lean() : null,
      TenantProduct.find({ tenantId, productMasterId: listing.productMasterId, _id: { $ne: listing._id } })
        .select('_id variantId price stockQty status').lean(),
    ]);
    const { master: masterGallery } = groupImagesByVariant(images);
    const withGalleries = attachVariantGalleries(variant ? [variant] : [], images);
    return {
      listing: listing.toObject(),
      master: master ? { id: master._id, title: master.title, slug: master.slug, skuGlobal: master.skuGlobal, type: master.type, description: master.description, isPerishable: master.isPerishable, defaultSellingUnit: master.defaultSellingUnit, status: master.status } : null,
      images: sortGallery(masterGallery).map((i) => ({ id: i._id, url: i.url, altText: i.altText, isPrimary: i.isPrimary })),
      variant: variant ? {
        id: variant._id, variantType: variant.variantType, value: variant.value,
        displayLabel: variant.displayLabel, sku: variant.sku, sortOrder: variant.sortOrder,
        isDefault: variant.isDefault, status: variant.status,
        images: withGalleries[0]?.images || [],
        imageSource: withGalleries[0]?.imageSource || 'master',
      } : null,
      // Other listings of the same master in this tenant (the variant family).
      siblings: (siblings || []).map((s) => ({
        id: s._id, variantId: s.variantId, price: s.price, stockQty: s.stockQty, status: s.status,
      })),
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
