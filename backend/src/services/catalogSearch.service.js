import mongoose from 'mongoose';
import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import ProductImage from '../models/productImage.model.js';
import ProductVariant from '../models/productVariant.model.js';
import Category from '../models/category.model.js';
import Brand from '../models/brand.model.js';
import inventoryService from './inventory.service.js';
import { groupImagesByVariant, resolveImagesForVariant, variantDisplayLabel, pickDefaultVariant } from '../utils/catalog/variantImages.js';
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
    if (query.categoryId) pipeline.push({ $match: { 'master.categoryId': toObjectId(query.categoryId) } });
    if (query.brandId) pipeline.push({ $match: { 'master.brandId': toObjectId(query.brandId) } });
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
    // Secondary master ordering keeps one product's variant listings ADJACENT,
    // so page-level variant grouping rarely splits a family across pages.
    pipeline.push({ $sort: { ...(sortMap[query.sort] || { _id: 1 }), 'master._id': 1 } });

    const totalAgg = await TenantProduct.aggregate([...pipeline, { $count: 'total' }]);
    const total = totalAgg[0]?.total ?? 0;
    const facets = await this.computeFacets(pipeline);

    pipeline.push({ $skip: skip }, { $limit: limit });

    const rows = await TenantProduct.aggregate([
      ...pipeline,
      {
        $lookup: {
          from: 'productvariants',
          localField: 'variantId',
          foreignField: '_id',
          as: 'variant',
        },
      },
      { $unwind: { path: '$variant', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          listingId: { $toString: '$_id' },
          variantId: {
            $cond: [{ $ifNull: ['$variant._id', false] }, { $toString: '$variant._id' }, null],
          },
          price: 1,
          stockQty: 1,
          availability: 1,
          variant: {
            $cond: [
              { $ifNull: ['$variant._id', false] },
              {
                id: { $toString: '$variant._id' },
                variantType: '$variant.variantType',
                value: '$variant.value',
                displayLabel: '$variant.displayLabel',
                sku: '$variant.sku',
                sortOrder: '$variant.sortOrder',
                isDefault: '$variant.isDefault',
              },
              null,
            ],
          },
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

    await this.attachVariantAwareImages(rows);

    return {
      items: rows,
      meta: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + rows.length < total,
        facets,
      },
    };
  }

  /** Facet counts over the SAME filter pipeline the list used, minus skip/limit. */
  async computeFacets(filterPipeline) {
    try {
      const [rows] = await TenantProduct.aggregate([
        ...filterPipeline,
        {
          $facet: {
            categories: [
              { $group: { _id: '$master.categoryId', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 12 },
            ],
            availability: [
              { $group: { _id: { $gt: ['$stockQty', 0] }, count: { $sum: 1 } } },
            ],
            price: [
              { $group: { _id: null, min: { $min: '$price.sellingPrice' }, max: { $max: '$price.sellingPrice' } } },
            ],
          },
        },
      ]);
      const catIds = (rows?.categories || []).map((c) => c._id).filter(Boolean);
      const cats = catIds.length
        ? await Category.find({ _id: { $in: catIds } }).select('name').lean()
        : [];
      const nameById = new Map(cats.map((c) => [String(c._id), c.name]));
      return {
        categories: (rows?.categories || [])
          .filter((c) => c._id)
          .map((c) => ({ id: String(c._id), name: nameById.get(String(c._id)) || null, count: c.count })),
        inStock: (rows?.availability || []).find((a) => a._id === true)?.count || 0,
        outOfStock: (rows?.availability || []).find((a) => a._id === false)?.count || 0,
        priceRange: rows?.price?.[0]
          ? { min: rows.price[0].min || 0, max: rows.price[0].max || 0 }
          : null,
      };
    } catch {
      return { categories: [], inStock: 0, outOfStock: 0, priceRange: null };
    }
  }

  /**
   * Variant-aware thumbnails for flat rows: each row's variant gallery wins,
   * else the master gallery (see variantImages.js). Two bounded queries for the
   * whole page regardless of row count. Rows gain `product.imageUrl`,
   * `product.imageSource` and `variant.label`.
   */
  async attachVariantAwareImages(rows) {
    const ids = [...new Set((rows || []).map((r) => r.product?.id).filter(Boolean))];
    if (!ids.length) return rows;
    const images = await ProductImage.find({
      productMasterId: { $in: ids },
      status: 'active',
      isDeleted: { $ne: true },
    }).sort({ isPrimary: -1, sortOrder: 1 }).lean();
    const byMaster = new Map();
    for (const img of images) {
      const k = String(img.productMasterId);
      if (!byMaster.has(k)) byMaster.set(k, []);
      byMaster.get(k).push(img);
    }
    for (const r of rows) {
      const flat = byMaster.get(String(r.product?.id)) || [];
      const { images: gallery, source } = resolveImagesForVariant(flat, r.variantId || null);
      if (gallery[0]?.url) {
        r.product.imageUrl = gallery[0].url;
        r.product.imageSource = source;
      }
      if (r.variant) r.variant.label = variantDisplayLabel(r.variant);
    }
    return rows;
  }

  /** Backward-compat alias (older callers attach master primaries only). */
  async attachPrimaryImages(rows) {
    return this.attachVariantAwareImages(rows);
  }

  /**
   * Group a page of flat listing rows into ONE card per master — the PLP
   * contract behind `?groupBy=master` (storefront dropdown cards).
   *
   * Each card carries the FULL listed-variant family (not just the variants on
   * this page), fetched in one bounded query, so the dropdown is complete and
   * the price range is honest. Card order follows first appearance, so ranked
   * order survives grouping. Pagination stays listing-based (see meta.total);
   * the secondary master sort in `search()` keeps families adjacent so a card
   * rarely straddles a page boundary.
   */
  async groupListingRows({ tenantId, rows }) {
    const list = rows || [];
    if (!list.length) return [];
    const masterIds = [...new Set(list.map((r) => String(r.product?.id)).filter(Boolean))];
    if (!masterIds.length) return [];

    const [family, variants, images] = await Promise.all([
      TenantProduct.find({
        tenantId, productMasterId: { $in: masterIds }, status: TENANT_LISTING_STATUS.ACTIVE,
      }).select('_id productMasterId variantId price stockQty availability').lean(),
      ProductVariant.find({ productMasterId: { $in: masterIds }, status: 'active' }).lean(),
      ProductImage.find({ productMasterId: { $in: masterIds }, status: 'active' }).sort({ isPrimary: -1, sortOrder: 1 }).lean(),
    ]);
    const variantById = new Map(variants.map((v) => [String(v._id), v]));
    const imagesByMaster = new Map();
    for (const img of images) {
      const k = String(img.productMasterId);
      if (!imagesByMaster.has(k)) imagesByMaster.set(k, []);
      imagesByMaster.get(k).push(img);
    }
    const familyByMaster = new Map();
    for (const l of family) {
      const k = String(l.productMasterId);
      if (!familyByMaster.has(k)) familyByMaster.set(k, []);
      familyByMaster.get(k).push(l);
    }

    const seen = new Set();
    const cards = [];
    for (const row of list) {
      const mid = String(row.product?.id);
      if (!mid || seen.has(mid)) continue;
      seen.add(mid);
      const members = familyByMaster.get(mid) || [];
      const flat = imagesByMaster.get(mid) || [];
      const variantsOut = members
        .map((l) => {
          const v = l.variantId ? variantById.get(String(l.variantId)) : null;
          // A listing whose variant was deactivated still exists — skip it so
          // the card never offers a dead SKU (the flat row stays for compat).
          if (l.variantId && !v) return null;
          const { images: gallery, source } = resolveImagesForVariant(flat, l.variantId || null);
          return {
            listingId: String(l._id),
            variantId: l.variantId ? String(l.variantId) : null,
            variantType: v?.variantType || null,
            value: v?.value || null,
            label: v ? variantDisplayLabel(v) : null,
            sku: v?.sku || null,
            sortOrder: v?.sortOrder ?? 0,
            isDefault: Boolean(v?.isDefault),
            price: l.price,
            stockQty: l.stockQty ?? 0,
            availability: l.availability,
            imageUrl: gallery[0]?.url || null,
            imageSource: source,
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.label || '').localeCompare(String(b.label || '')));
      if (!variantsOut.length) continue;

      const prices = variantsOut.map((v) => Number(v.price?.sellingPrice ?? 0)).filter((n) => Number.isFinite(n));
      const def = pickDefaultVariant(variantsOut.map((v) => ({
        variant: { isDefault: v.isDefault, sortOrder: v.sortOrder, value: v.value },
        stockQty: v.stockQty,
      })));
      // pickDefaultVariant returns the wrapper; map back to the variant row.
      const defRow = def
        ? variantsOut.find((v) => (v.isDefault === def.variant?.isDefault && v.sortOrder === def.variant?.sortOrder && v.value === def.variant?.value))
        : null;
      const fallback = defRow || variantsOut.find((v) => v.isDefault) || variantsOut.find((v) => v.stockQty > 0) || variantsOut[0];
      const { images: masterGallery } = groupImagesByVariant(flat);

      cards.push({
        masterId: mid,
        product: {
          ...row.product,
          imageUrl: fallback.imageUrl || masterGallery[0]?.url || row.product?.imageUrl || null,
          imageSource: fallback.imageSource || 'master',
        },
        priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
        variantCount: variantsOut.length,
        inStockCount: variantsOut.filter((v) => v.stockQty > 0).length,
        defaultListingId: String(fallback.listingId),
        variants: variantsOut,
      });
    }
    return cards;
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
