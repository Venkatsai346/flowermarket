import mongoose from 'mongoose';
import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import Category from '../models/category.model.js';
import Brand from '../models/brand.model.js';
import inventoryService from './inventory.service.js';
import { TENANT_LISTING_STATUS, PRODUCT_MASTER_STATUS } from '../constants/enums.js';

/** Aggregation pipelines do NOT auto-cast ids — always normalize to ObjectId. */
const toObjectId = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(v));

/**
 * CatalogSearchService — the CUSTOMER-facing merged view (read side).
 *
 * Implements the architecture doc's read flow:
 *   "Fetch ProductMaster + TenantProduct WHERE tenant_id=? -> merge global attrs
 *    + tenant fields -> filter tenant_status = ACTIVE -> cache"
 *
 * Only listings with status=ACTIVE AND master.status=ACTIVE surface. Stock
 * comes from the denormalized TenantProduct.stockQty (fast); a batch inventory
 * lookup patches exact availability when requested.
 *
 * NOTE: cache (Redis) + search index (Elasticsearch) are the roadmap; this
 * service is the correct source-of-truth query behind them.
 */
class CatalogSearchService {
  /**
   * Customer catalog query for one tenant.
   */
  async search({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const match = {
      tenantId: toObjectId(tenantId),
      status: TENANT_LISTING_STATUS.ACTIVE,
      isDeleted: { $ne: true },
    };

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: 'productmasters',
          localField: 'productMasterId',
          foreignField: '_id',
          as: 'master',
        },
      },
      { $unwind: { path: '$master', preserveNullAndEmptyArrays: false } },
      { $match: { 'master.status': PRODUCT_MASTER_STATUS.ACTIVE, 'master.isDeleted': { $ne: true } } },
    ];

    // ---- filters ----
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      pipeline.push({
        $match: {
          $or: [
            { 'master.title': rx },
            { 'master.searchText': rx },
            { 'master.skuGlobal': rx },
            { 'master.tags': rx },
          ],
        },
      });
    }
    if (query.categoryId) pipeline.push({ $match: { 'master.categoryId': query.categoryId } });
    if (query.brandId) pipeline.push({ $match: { 'master.brandId': query.brandId } });
    if (query.type) pipeline.push({ $match: { 'master.type': query.type } });
    if (query.minPrice !== undefined) pipeline.push({ $match: { 'price.sellingPrice': { $gte: Number(query.minPrice) } } });
    if (query.maxPrice !== undefined) pipeline.push({ $match: { 'price.sellingPrice': { $lte: Number(query.maxPrice) } } });
    if (query.inStock) pipeline.push({ $match: { stockQty: { $gt: 0 } } });

    // ---- sort ----
    const sortMap = {
      price_asc: { 'price.sellingPrice': 1 },
      price_desc: { 'price.sellingPrice': -1 },
      newest: { createdAt: -1 },
      popularity: { 'master.soldCount': -1 },
      relevance: { 'master.searchText': -1 },
    };
    pipeline.push({ $sort: sortMap[query.sort] || { _id: 1 } });

    const totalAgg = await TenantProduct.aggregate([...pipeline, { $count: 'total' }]);
    const total = totalAgg[0]?.total ?? 0;

    pipeline.push({ $skip: skip }, { $limit: limit });

    const rows = await TenantProduct.aggregate([
      ...pipeline,
      {
        $project: {
          _id: 0,
          listingId: { $toString: '$_id' },
          price: 1,
          stockQty: 1,
          availability: 1,
          product: {
            id: { $toString: '$master._id' },
            title: '$master.title',
            slug: '$master.slug',
            skuGlobal: '$master.skuGlobal',
            type: '$master.type',
            shortDescription: '$master.shortDescription',
            categoryId: '$master.categoryId',
            brandId: '$master.brandId',
            isPerishable: '$master.isPerishable',
            requiresColdChain: '$master.requiresColdChain',
            defaultSellingUnit: '$master.defaultSellingUnit',
            soldCount: '$master.soldCount',
            searchText: '$master.searchText',
          },
        },
      },
    ]);

    // ---- batch stock patch (exact availability when requested) ----
    if (query.inStock) {
      const ids = rows.map((r) => r.listingId);
      if (ids.length) {
        const stockMap = await inventoryService.bulkGetStock({ tenantId, listingIds: ids });
        for (const r of rows) {
          const s = stockMap[r.listingId];
          if (s) {
            r.stockQty = s.qtyAvailable;
            r.availability = { status: s.qtyAvailable > 0 ? 'in_stock' : 'out_of_stock', updatedAt: new Date() };
          }
        }
      }
    }

    return { items: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: skip + rows.length < total } };
  }

  /** Search across GLOBAL masters (admin/taxonomy view). */
  async searchMasters({ query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = {};
    if (query.search) {
      const rx = new RegExp(query.search, 'i');
      q.$or = [{ title: rx }, { skuGlobal: rx }, { searchText: rx }];
    }
    if (query.status) q.status = query.status;
    if (query.categoryId) q.categoryId = query.categoryId;
    const [docs, total] = await Promise.all([
      ProductMaster.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ProductMaster.countDocuments(q),
    ]);
    return { items: docs, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  /** Category tree for the customer app (active only). */
  async customerCategories() {
    const cats = await Category.find({ status: { $ne: 'inactive' } }).sort({ sortOrder: 1, name: 1 }).lean();
    const byParent = new Map();
    for (const c of cats) {
      const key = String(c.parentId || 'root');
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push({ id: c._id, name: c.name, slug: c.slug, iconUrl: c.iconUrl });
    }
    const attach = (cat) => ({ ...cat, children: byParent.get(String(cat.id))?.map(attach) || [] });
    return (byParent.get('root') || []).map(attach);
  }

  /** Brand list for filter chips. */
  async customerBrands() {
    const brands = await Brand.find({ status: 'active', 'verification.isVerified': true }).sort({ name: 1 }).lean();
    return brands.map((b) => ({ id: b._id, name: b.name, slug: b.slug }));
  }
}

export default new CatalogSearchService();
