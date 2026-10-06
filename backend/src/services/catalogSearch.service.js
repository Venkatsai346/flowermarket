import crypto from 'node:crypto';
import mongoose from 'mongoose';
import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import ProductImage from '../models/productImage.model.js';
import ProductVariant from '../models/productVariant.model.js';
import ProductAttributeValue from '../models/productAttributeValue.model.js';
import ProductVariantAttributeValue from '../models/productVariantAttributeValue.model.js';
import Category from '../models/category.model.js';
import Brand from '../models/brand.model.js';
import inventoryService from './inventory.service.js';
import { groupImagesByVariant, resolveImagesForVariant, variantDisplayLabel, pickDefaultVariant } from '../utils/catalog/variantImages.js';
import { literalRegex } from '../utils/regex.js';
import { TENANT_LISTING_STATUS, PRODUCT_MASTER_STATUS } from '../constants/enums.js';
import { badRequest } from '../utils/ApiError.js';

/** Aggregation pipelines do NOT auto-cast ids — always normalize to ObjectId. */
const toObjectId = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(v));

const GROUPED_SORTS = Object.freeze({
  relevance: { direction: -1, kind: 'number' },
  price_asc: { direction: 1, kind: 'number' },
  price_desc: { direction: -1, kind: 'number' },
  newest: { direction: -1, kind: 'date' },
  popularity: { direction: -1, kind: 'number' },
});

/** Cursor payloads are deliberately opaque, query-bound and versioned. */
const encodeCatalogCursor = ({ sort, value, id, fingerprint }) => Buffer.from(JSON.stringify({
  v: 2, s: sort, k: value instanceof Date ? value.toISOString() : value, i: String(id), f: fingerprint,
})).toString('base64url');

const decodeCatalogCursor = (raw, expectedSort, expectedFingerprint) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (parsed?.v !== 2 || parsed.s !== expectedSort || parsed.f !== expectedFingerprint || !mongoose.isValidObjectId(parsed.i)) return null;
    const config = GROUPED_SORTS[expectedSort];
    const value = config.kind === 'date' ? new Date(parsed.k) : Number(parsed.k);
    if ((config.kind === 'date' && Number.isNaN(value.getTime())) || (config.kind === 'number' && !Number.isFinite(value))) return null;
    return { value, id: toObjectId(parsed.i) };
  } catch {
    return null;
  }
};

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
  /** Resolve a category to itself + all active descendants in one server-side walk. */
  async categoryScope(categoryId) {
    if (!categoryId) return null;
    const [scope] = await Category.aggregate([
      { $match: { _id: toObjectId(categoryId), status: { $ne: 'inactive' }, isDeleted: { $ne: true } } },
      {
        $graphLookup: {
          from: 'categories', startWith: '$_id', connectFromField: '_id', connectToField: 'parentId',
          as: 'descendants', restrictSearchWithMatch: { status: { $ne: 'inactive' }, isDeleted: { $ne: true } },
        },
      },
      { $project: { ids: { $concatArrays: [['$_id'], '$descendants._id'] } } },
    ]);
    // A deleted/unknown category intentionally matches nothing rather than
    // accidentally widening the request to the complete catalogue.
    return scope?.ids || [];
  }

  /** Category-governed attributes that are safe and meaningful on a PLP. */
  async facetDefinitions(categoryIds) {
    if (!categoryIds?.length) return [];
    const categories = await Category.find({ _id: { $in: categoryIds }, isDeleted: { $ne: true } })
      .select('attributeSchema').lean();
    const byKey = new Map();
    for (const category of categories) {
      const seenInCategory = new Set();
      for (const field of category.attributeSchema || []) {
        if ((!field.facetable && !field.filterable) || seenInCategory.has(field.key)) continue;
        seenInCategory.add(field.key);
        const existing = byKey.get(field.key);
        if (existing) existing.categoryCount += 1;
        else byKey.set(field.key, {
          key: field.key,
          label: field.label || field.key.replace(/_/g, ' '),
          type: field.type || 'string',
          unit: field.unit || null,
          options: (field.options || []).slice(0, 100),
          categoryCount: 1,
        });
      }
    }
    return [...byKey.values()]
      .sort((a, b) => (b.categoryCount - a.categoryCount) || a.key.localeCompare(b.key))
      .slice(0, 16)
      .map(({ categoryCount, ...definition }) => definition);
  }

  /**
   * Product-family read model used by every modern storefront PLP.
   *
   * Filtering happens against valid live variant listings, then rows are
   * grouped BEFORE count, facets and pagination. The selected page is hydrated
   * with the complete active family through groupListingRows(), so a price or
   * stock filter determines whether a product matches without silently hiding
   * its other selectable variants.
   */
  async searchGrouped({ tenantId, query = {}, rankedMasterIds = null }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(60, Math.max(1, Number(query.limit) || 24));
    const sort = GROUPED_SORTS[query.sort] ? query.sort : 'relevance';
    const sortConfig = GROUPED_SORTS[sort];
    const categoryIds = await this.categoryScope(query.categoryId);
    const attributeFilters = query.attributes || {};
    const attributeDefinitions = await this.facetDefinitions(categoryIds);
    const allowedAttributeKeys = new Set(attributeDefinitions.map((field) => field.key));
    const requestedAttributeKeys = Object.keys(attributeFilters);
    const unknownAttributeKeys = requestedAttributeKeys.filter((key) => !allowedAttributeKeys.has(key));
    if (unknownAttributeKeys.length) {
      throw badRequest(
        'One or more attribute filters are not available for this category',
        'INVALID_CATALOG_ATTRIBUTE_FILTER',
        { attributes: unknownAttributeKeys },
      );
    }
    const normalizedAttributeFilters = Object.entries(attributeFilters);
    const rankedIds = Array.isArray(rankedMasterIds) ? rankedMasterIds.map(toObjectId) : null;
    const cursorFingerprint = crypto.createHash('sha256').update(JSON.stringify({
      tenantId: String(tenantId), search: query.search || '', categoryId: query.categoryId || '',
      brandId: query.brandId || '', type: query.type || '', minPrice: query.minPrice ?? null,
      maxPrice: query.maxPrice ?? null, inStock: Boolean(query.inStock), sort,
      pincode: query.pincode || '',
      attributes: Object.fromEntries(Object.entries(attributeFilters).sort(([a], [b]) => a.localeCompare(b))),
    })).digest('hex').slice(0, 16);
    const cursor = decodeCatalogCursor(query.cursor, sort, cursorFingerprint);
    if (query.cursor && !cursor) {
      throw badRequest('Catalog cursor is stale or does not belong to this filter set', 'INVALID_CATALOG_CURSOR');
    }

    const pipeline = [
      {
        $match: {
          tenantId: toObjectId(tenantId), status: TENANT_LISTING_STATUS.ACTIVE,
          isDeleted: { $ne: true }, 'price.sellingPrice': { $ne: null },
          'channels.storefront': { $ne: false },
        },
      },
      { $lookup: { from: 'productmasters', localField: 'productMasterId', foreignField: '_id', as: 'master' } },
      { $unwind: { path: '$master', preserveNullAndEmptyArrays: false } },
      {
        $match: {
          'master.status': PRODUCT_MASTER_STATUS.ACTIVE,
          'master.complianceStatus': { $ne: 'pending' },
          'master.isDeleted': { $ne: true },
        },
      },
      { $lookup: { from: 'productvariants', localField: 'variantId', foreignField: '_id', as: 'variant' } },
      { $unwind: { path: '$variant', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: [
            { variantId: null },
            { 'variant._id': { $ne: null }, 'variant.status': 'active', 'variant.isDeleted': { $ne: true } },
          ],
        },
      },
    ];

    // A delivery pincode turns availability into an exact fulfillment-node
    // projection before family grouping, filtering, totals and facets. This is
    // intentionally not a post-page patch: that would produce sparse pages and
    // listing/network counts instead of locally promiseable product families.
    if (Array.isArray(query.fulfillmentWarehouseIds)) {
      const warehouseIds = query.fulfillmentWarehouseIds.map((id) => (id ? toObjectId(id) : null));
      const policySafety = Number(query.fulfillmentSafetyStock || 0);
      pipeline.push(
        {
          $lookup: {
            from: 'inventories',
            let: { listingId: '$_id' },
            pipeline: [
              { $match: { $expr: { $and: [
                { $eq: ['$tenantId', toObjectId(tenantId)] },
                { $eq: ['$tenantProductId', '$$listingId'] },
                { $in: ['$warehouseId', warehouseIds] },
                { $ne: ['$isDeleted', true] },
                { $ne: ['$isSellable', false] },
                { $eq: ['$status', 'active'] },
              ] } } },
              { $project: {
                warehouseId: 1,
                available: { $max: [0, { $subtract: [
                  '$qtyOnHand',
                  { $add: ['$qtyReserved', { $ifNull: ['$safetyStock', 0] }, policySafety] },
                ] }] },
              } },
            ],
            as: 'fulfillmentInventory',
          },
        },
        {
          $set: {
            stockQty: {
              $let: {
                vars: {
                  real: { $filter: { input: '$fulfillmentInventory', as: 'row', cond: { $ne: ['$$row.warehouseId', null] } } },
                },
                in: {
                  $sum: {
                    $map: {
                      input: { $cond: [{ $gt: [{ $size: '$$real' }, 0] }, '$$real', '$fulfillmentInventory'] },
                      as: 'row', in: '$$row.available',
                    },
                  },
                },
              },
            },
          },
        },
      );
    }

    if (rankedIds) pipeline.push({ $match: { 'master._id': { $in: rankedIds } } });
    if (query.search && !rankedIds) {
      const rx = literalRegex(query.search);
      pipeline.push({ $match: { $or: [
        { 'master.title': rx }, { 'master.searchText': rx },
        { 'master.skuGlobal': rx }, { 'master.tags': rx },
      ] } });
    }
    if (query.categoryId) pipeline.push({ $match: { 'master.categoryId': { $in: categoryIds } } });
    if (query.brandId) pipeline.push({ $match: { 'master.brandId': toObjectId(query.brandId) } });
    if (query.excludeMasterId) pipeline.push({ $match: { 'master._id': { $ne: toObjectId(query.excludeMasterId) } } });
    if (query.type) pipeline.push({ $match: { 'master.type': query.type } });
    if (query.minPrice !== undefined) pipeline.push({ $match: { 'price.sellingPrice': { $gte: Number(query.minPrice) } } });
    if (query.maxPrice !== undefined) pipeline.push({ $match: { 'price.sellingPrice': { $lte: Number(query.maxPrice) } } });
    if (query.inStock) pipeline.push({ $match: { stockQty: { $gt: 0 } } });

    if (attributeDefinitions.length) {
      pipeline.push(
        { $lookup: { from: ProductAttributeValue.collection.name, localField: 'master._id', foreignField: 'productMasterId', as: 'masterAttributes' } },
        { $lookup: { from: ProductVariantAttributeValue.collection.name, localField: 'variant._id', foreignField: 'productVariantId', as: 'variantAttributes' } },
        {
          $set: {
            allAttributes: {
              $filter: {
                input: { $concatArrays: ['$masterAttributes', '$variantAttributes'] },
                as: 'attribute',
                cond: { $ne: ['$$attribute.isDeleted', true] },
              },
            },
          },
        },
      );
      for (const [key, filter] of normalizedAttributeFilters) {
        const valueMatch = filter && typeof filter === 'object' && !Array.isArray(filter)
          ? {
            numberValue: {
              ...(filter.min != null ? { $gte: Number(filter.min) } : {}),
              ...(filter.max != null ? { $lte: Number(filter.max) } : {}),
            },
          }
          : { value: { $in: Array.isArray(filter) ? filter : [filter] } };
        pipeline.push({ $match: { allAttributes: { $elemMatch: { attributeKey: key, ...valueMatch } } } });
      }
    }

    pipeline.push({
      $group: {
        _id: '$master._id',
        master: { $first: '$master' },
        titleOverride: { $first: '$merchandising.titleOverride' },
        descriptionOverride: { $first: '$merchandising.descriptionOverride' },
        minPrice: { $min: '$price.sellingPrice' },
        maxPrice: { $max: '$price.sellingPrice' },
        anyInStock: { $max: { $cond: [{ $gt: ['$stockQty', 0] }, 1, 0] } },
        newestAt: { $max: '$createdAt' },
        featured: { $max: { $cond: ['$merchandising.featured', 1, 0] } },
        searchBoost: { $max: { $ifNull: ['$merchandising.searchBoost', 0] } },
        attributeRows: { $push: { $ifNull: ['$allAttributes', []] } },
      },
    });

    const sortExpression = {
      price_asc: '$minPrice', price_desc: '$maxPrice', newest: '$newestAt',
      popularity: { $ifNull: ['$master.soldCount', 0] },
      relevance: rankedIds
        ? { $subtract: [rankedIds.length, { $indexOfArray: [rankedIds, '$_id'] }] }
        : { $add: [{ $multiply: ['$featured', 1000] }, '$searchBoost', { $ifNull: ['$master.soldCount', 0] }] },
    }[sort];
    pipeline.push({ $set: { _sort: sortExpression } });

    const itemStages = [];
    if (cursor) {
      const comparator = sortConfig.direction === 1 ? '$gt' : '$lt';
      itemStages.push({ $match: { $or: [
        { _sort: { [comparator]: cursor.value } },
        { _sort: cursor.value, _id: { $gt: cursor.id } },
      ] } });
    }
    itemStages.push(
      { $sort: { _sort: sortConfig.direction, _id: 1 } },
      // Fetch one extra family to produce an exact hasMore without arithmetic.
      ...(cursor ? [] : [{ $skip: (page - 1) * limit }]),
      { $limit: limit + 1 },
      {
        $project: {
          _id: 1, master: 1, titleOverride: 1, descriptionOverride: 1,
          minPrice: 1, maxPrice: 1, anyInStock: 1, newestAt: 1, _sort: 1,
        },
      },
    );

    const facetPipelines = {
      items: itemStages,
      total: [{ $count: 'count' }],
      categories: [{ $group: { _id: '$master.categoryId', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 24 }],
      brands: [{ $match: { 'master.brandId': { $ne: null } } }, { $group: { _id: '$master.brandId', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 24 }],
      types: [{ $match: { 'master.type': { $nin: [null, ''] } } }, { $group: { _id: '$master.type', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 24 }],
      availability: [{ $group: { _id: '$anyInStock', count: { $sum: 1 } } }],
      price: [{ $group: { _id: null, min: { $min: '$minPrice' }, max: { $max: '$maxPrice' } } }],
    };
    if (attributeDefinitions.length) {
      facetPipelines.attributes = [
        { $unwind: '$attributeRows' },
        { $unwind: '$attributeRows' },
        { $match: { 'attributeRows.attributeKey': { $in: attributeDefinitions.map((field) => field.key) } } },
        {
          $project: {
            masterId: '$_id', key: '$attributeRows.attributeKey', unit: '$attributeRows.unit',
            values: { $cond: [{ $isArray: '$attributeRows.value' }, '$attributeRows.value', ['$attributeRows.value']] },
          },
        },
        { $unwind: '$values' },
        { $match: { $expr: { $in: [{ $type: '$values' }, ['string', 'double', 'int', 'long', 'decimal', 'bool']] } } },
        { $group: { _id: { masterId: '$masterId', key: '$key', value: '$values' }, unit: { $first: '$unit' } } },
        { $group: { _id: { key: '$_id.key', value: '$_id.value' }, count: { $sum: 1 }, unit: { $first: '$unit' } } },
        { $sort: { count: -1, '_id.value': 1 } },
        { $limit: 320 },
      ];
    }

    const [result = {}] = await TenantProduct.aggregate([
      ...pipeline,
      { $facet: facetPipelines },
    ]);

    const candidates = result.items || [];
    const hasMore = candidates.length > limit;
    const selected = candidates.slice(0, limit);
    const representativeRows = selected.map((entry) => ({
      product: {
        id: String(entry._id),
        title: entry.titleOverride || entry.master.title,
        canonicalTitle: entry.master.title,
        slug: entry.master.slug,
        skuGlobal: entry.master.skuGlobal,
        type: entry.master.type,
        kind: entry.master.kind,
        complianceStatus: entry.master.complianceStatus,
        shortDescription: entry.descriptionOverride || entry.master.shortDescription,
        categoryId: entry.master.categoryId,
        brandId: entry.master.brandId,
        isPerishable: entry.master.isPerishable,
        requiresColdChain: entry.master.requiresColdChain,
        returnPolicy: entry.master.returnPolicy,
        defaultSellingUnit: entry.master.defaultSellingUnit,
        unitPolicy: entry.master.unitPolicy,
        options: entry.master.options,
        optionRules: entry.master.optionRules,
        manufacturer: entry.master.manufacturer,
        modelNumber: entry.master.modelNumber,
        condition: entry.master.condition,
        fulfillmentProfile: entry.master.fulfillmentProfile,
        soldCount: entry.master.soldCount,
        searchText: entry.master.searchText,
      },
    }));
    const cards = await this.groupListingRows({ tenantId, rows: representativeRows });
    // Preserve aggregate order even if legacy data caused a family to be
    // discarded during hydration.
    const cardById = new Map(cards.map((card) => [String(card.masterId), card]));
    let orderedCards = selected.map((entry) => cardById.get(String(entry._id))).filter(Boolean);
    if (query.pincode && orderedCards.length) {
      const { default: warehouseAllocationService } = await import('./warehouseAllocation.service.js');
      const listingIds = orderedCards.flatMap((card) => (card.variants || []).map((variant) => variant.listingId));
      const exact = await warehouseAllocationService.availability({ tenantId, listingIds, pincode: query.pincode });
      orderedCards = orderedCards.map((card) => {
        const variants = (card.variants || []).map((variant) => {
          const item = exact.byListing[String(variant.listingId)] || {};
          return {
            ...variant,
            stockQty: item.networkAvailableQty || 0,
            availability: {
              status: item.networkAvailableQty > 0 ? 'in_stock' : 'out_of_stock',
              qtyAvailable: item.networkAvailableQty || 0,
              fulfillmentNodeCount: item.nodes?.length || 0,
              nearestNode: item.best ? {
                id: item.best.fulfillmentHubId,
                name: item.best.warehouseName,
                distanceKm: item.best.distanceKm,
              } : null,
            },
          };
        });
        const selectedVariant = variants.find((variant) => String(variant.listingId) === String(card.defaultListingId))
          || variants.find((variant) => variant.stockQty > 0) || variants[0];
        return {
          ...card, variants,
          defaultListingId: selectedVariant?.listingId || card.defaultListingId,
          inStockCount: variants.filter((variant) => variant.stockQty > 0).length,
          stockSummary: {
            totalAvailable: variants.reduce((sum, variant) => sum + Number(variant.stockQty || 0), 0),
            inStockCount: variants.filter((variant) => variant.stockQty > 0).length,
            totalVariants: variants.length,
            scope: 'serviceable_nodes',
          },
        };
      });
    }

    const catIds = (result.categories || []).map((row) => row._id).filter(Boolean);
    const brandIds = (result.brands || []).map((row) => row._id).filter(Boolean);
    const [cats, brands] = await Promise.all([
      catIds.length ? Category.find({ _id: { $in: catIds } }).select('name').lean() : [],
      brandIds.length ? Brand.find({ _id: { $in: brandIds } }).select('name').lean() : [],
    ]);
    const categoryNames = new Map(cats.map((cat) => [String(cat._id), cat.name]));
    const brandNames = new Map(brands.map((brand) => [String(brand._id), brand.name]));
    const attributeRowsByKey = new Map();
    for (const row of result.attributes || []) {
      const key = String(row._id?.key || '');
      if (!key) continue;
      if (!attributeRowsByKey.has(key)) attributeRowsByKey.set(key, []);
      const values = attributeRowsByKey.get(key);
      if (values.length < 20) values.push({ value: row._id.value, count: row.count, unit: row.unit || null });
    }
    const attributeFacets = attributeDefinitions.map((definition) => {
      const observed = attributeRowsByKey.get(definition.key) || [];
      const observedByValue = new Map(observed.map((row) => [JSON.stringify(row.value), row]));
      const vocabulary = (definition.options || []).map((value) => (
        observedByValue.get(JSON.stringify(value)) || { value, count: null, unit: definition.unit || null }
      ));
      const vocabularyKeys = new Set(vocabulary.map((row) => JSON.stringify(row.value)));
      return {
        ...definition,
        values: [...vocabulary, ...observed.filter((row) => !vocabularyKeys.has(JSON.stringify(row.value)))].slice(0, 20),
      };
    }).filter((definition) => definition.values.length);
    const total = result.total?.[0]?.count || 0;
    const last = selected[selected.length - 1];
    const nextCursor = hasMore && last
      ? encodeCatalogCursor({ sort, value: last._sort, id: last._id, fingerprint: cursorFingerprint })
      : null;

    return {
      items: orderedCards,
      meta: {
        page: cursor ? null : page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore,
        nextCursor,
        pagination: 'master_cursor',
        grouped: true,
        groupedCount: orderedCards.length,
        facets: {
          categories: (result.categories || []).filter((row) => row._id).map((row) => ({
            id: String(row._id), name: categoryNames.get(String(row._id)) || null, count: row.count,
          })),
          brands: (result.brands || []).filter((row) => row._id).map((row) => ({
            id: String(row._id), name: brandNames.get(String(row._id)) || null, count: row.count,
          })),
          types: (result.types || []).filter((row) => row._id).map((row) => ({
            value: String(row._id), count: row.count,
          })),
          attributes: attributeFacets,
          inStock: (result.availability || []).find((row) => row._id === 1)?.count || 0,
          outOfStock: (result.availability || []).find((row) => row._id === 0)?.count || 0,
          priceRange: result.price?.[0] ? { min: result.price[0].min || 0, max: result.price[0].max || 0 } : null,
        },
      },
    };
  }

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
      // Defense in depth: a priceless listing must never reach the customer,
      // even if one slipped past the activation gate (legacy data, race).
      'price.sellingPrice': { $ne: null },
      'channels.storefront': { $ne: false },
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
      { $match: { 'master.status': PRODUCT_MASTER_STATUS.ACTIVE, 'master.complianceStatus': { $ne: 'pending' }, 'master.isDeleted': { $ne: true } } },
      // Resolve variants before count/facets/pagination so archived, deleted or
      // dangling variant listings never inflate totals or surface as a false
      // master-level row. A null variantId is the legitimate master listing.
      {
        $lookup: {
          from: 'productvariants', localField: 'variantId', foreignField: '_id', as: 'variant',
        },
      },
      { $unwind: { path: '$variant', preserveNullAndEmptyArrays: true } },
      {
        $match: {
          $or: [
            { variantId: null },
            { 'variant._id': { $ne: null }, 'variant.status': 'active', 'variant.isDeleted': { $ne: true } },
          ],
        },
      },
    ];

    // ---- filters ----
    if (query.search) {
      const rx = literalRegex(query.search); // escaped — raw input never reaches new RegExp
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
    if (query.excludeMasterId) pipeline.push({ $match: { 'master._id': { $ne: toObjectId(query.excludeMasterId) } } });
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
        $project: {
          _id: 0,
          listingId: { $toString: '$_id' },
          variantId: {
            $cond: [{ $ifNull: ['$variant._id', false] }, { $toString: '$variant._id' }, null],
          },
          price: 1,
          priceBasis: 1,
          stockQty: 1,
          availability: 1,
          variant: {
            $cond: [
              { $ifNull: ['$variant._id', false] },
              {
                id: { $toString: '$variant._id' },
                variantType: '$variant.variantType',
                value: '$variant.value',
                optionValues: '$variant.optionValues',
                combinationKey: '$variant.combinationKey',
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
            title: { $ifNull: ['$merchandising.titleOverride', '$master.title'] },
            canonicalTitle: '$master.title',
            slug: '$master.slug',
            skuGlobal: '$master.skuGlobal',
            type: '$master.type',
            kind: '$master.kind',
            complianceStatus: '$master.complianceStatus',
            shortDescription: { $ifNull: ['$merchandising.descriptionOverride', '$master.shortDescription'] },
            categoryId: '$master.categoryId',
            brandId: '$master.brandId',
            isPerishable: '$master.isPerishable',
            requiresColdChain: '$master.requiresColdChain',
            returnPolicy: '$master.returnPolicy',
            defaultSellingUnit: '$master.defaultSellingUnit',
            unitPolicy: '$master.unitPolicy',
            options: '$master.options',
            optionRules: '$master.optionRules',
            manufacturer: '$master.manufacturer',
            modelNumber: '$master.modelNumber',
            condition: '$master.condition',
            fulfillmentProfile: '$master.fulfillmentProfile',
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
        tenantId,
        productMasterId: { $in: masterIds },
        status: TENANT_LISTING_STATUS.ACTIVE,
        isDeleted: { $ne: true },
        'price.sellingPrice': { $ne: null },
        'channels.storefront': { $ne: false },
      }).select('_id productMasterId variantId price priceBasis stockQty availability').lean(),
      ProductVariant.find({ productMasterId: { $in: masterIds }, status: 'active', isDeleted: { $ne: true } }).lean(),
      ProductImage.find({ productMasterId: { $in: masterIds }, status: 'active', isDeleted: { $ne: true } }).sort({ isPrimary: -1, sortOrder: 1 }).lean(),
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
            optionValues: v?.optionValues || [],
            sellQuantity: v?.sellQuantity || null,
            price: l.price,
            priceBasis: l.priceBasis,
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
      // `groupImagesByVariant` returns `{ master, byVariant }`. Empty-media
      // products are valid, so the fallback must always remain an array.
      const { master: masterGallery = [] } = groupImagesByVariant(flat);

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
      const rx = literalRegex(query.search); // escaped — raw input never reaches new RegExp
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
      byParent.get(key).push({
        id: c._id,
        parentId: c.parentId || null,
        name: c.name,
        slug: c.slug,
        description: c.description || null,
        imageUrl: c.imageUrl || null,
        iconUrl: c.iconUrl || null,
        bannerUrl: c.bannerUrl || null,
        isFeatured: Boolean(c.isFeatured),
      });
    }
    // Cycle-safe (legacy data could hold a parent cycle): prune, never recurse
    // forever — this endpoint is public and must not 500 on bad data.
    const attach = (cat, seen) => {
      const visited = new Set(seen);
      visited.add(String(cat.id));
      const children = (byParent.get(String(cat.id)) || [])
        .filter((ch) => !visited.has(String(ch.id)))
        .map((ch) => attach(ch, visited));
      return { ...cat, children };
    };
    return (byParent.get('root') || []).map((c) => attach(c, new Set()));
  }

  /** Brand list for filter chips. */
  async customerBrands() {
    const brands = await Brand.find({ status: 'active', 'verification.isVerified': true }).sort({ name: 1 }).lean();
    return brands.map((b) => ({ id: b._id, name: b.name, slug: b.slug, logoUrl: b.logoUrl || null }));
  }

  /**
   * Brands MAPPED TO THIS TENANT — the storefront brands page source.
   *
   * A brand appears here iff ≥1 ACTIVE listing in this tenant points (through
   * its master) at it. Verification is surfaced as a badge, not a filter: a
   * store that chose to sell a brand should show it even before platform
   * verification lands. Ordered featured-first, then most-stocked.
   */
  async storefrontBrands({ tenantId }) {
    const rows = await TenantProduct.aggregate([
      { $match: { tenantId: toObjectId(tenantId), status: TENANT_LISTING_STATUS.ACTIVE, isDeleted: { $ne: true }, 'price.sellingPrice': { $ne: null }, 'channels.storefront': { $ne: false } } },
      {
        $lookup: {
          from: 'productmasters', localField: 'productMasterId', foreignField: '_id', as: 'master',
        },
      },
      { $unwind: '$master' },
      {
        $match: {
          'master.status': PRODUCT_MASTER_STATUS.ACTIVE,
          'master.complianceStatus': { $ne: 'pending' },
          'master.isDeleted': { $ne: true },
          'master.brandId': { $ne: null },
        },
      },
      // A master can have many listed variants; storefront copy says
      // "products", so count each master once while retaining its from-price.
      {
        $group: {
          _id: { brandId: '$master.brandId', masterId: '$master._id' },
          fromPrice: { $min: '$price.sellingPrice' },
        },
      },
      {
        $group: {
          _id: '$_id.brandId',
          productCount: { $sum: 1 },
          fromPrice: { $min: '$fromPrice' },
        },
      },
      { $lookup: { from: 'brands', localField: '_id', foreignField: '_id', as: 'brand' } },
      { $unwind: '$brand' },
      { $match: { 'brand.status': 'active', 'brand.isDeleted': { $ne: true } } },
      {
        $project: {
          _id: 0,
          id: '$_id',
          productCount: 1,
          fromPrice: 1,
          name: '$brand.name',
          slug: '$brand.slug',
          logoUrl: '$brand.logoUrl',
          bannerUrl: '$brand.bannerUrl',
          tagline: '$brand.tagline',
          description: '$brand.description',
          story: '$brand.story',
          countryOfOrigin: '$brand.countryOfOrigin',
          website: '$brand.website',
          foundedYear: '$brand.foundedYear',
          headquarters: '$brand.headquarters',
          socialLinks: '$brand.socialLinks',
          isVerified: '$brand.verification.isVerified',
          isFeatured: '$brand.isFeatured',
          sortOrder: '$brand.sortOrder',
        },
      },
    ]);
    // Featured first → curated order → most stocked → alphabetical. Done in JS
    // (not $sort) so the ordering rule stays identical wherever brands list.
    rows.sort((a, b) => (
      Number(b.isFeatured || false) - Number(a.isFeatured || false)
      || (a.sortOrder || 0) - (b.sortOrder || 0)
      || (b.productCount || 0) - (a.productCount || 0)
      || String(a.name || '').localeCompare(String(b.name || ''))
    ));
    return rows;
  }

  /**
   * Categories MAPPED TO THIS TENANT — the storefront categories page source.
   *
   * Direct listing counts come from one aggregation; ancestor roll-up happens
   * in JS (taxonomy is hundreds of rows, not millions): a parent with no
   * direct listings still appears when a descendant sells, carrying the
   * subtree `totalCount`. Branches with nothing sellable anywhere are pruned,
   * so the storefront never links into an empty shelf.
   *
   * @returns {{ tree: array, flat: array }} nested roots + flat lookup (with parentId).
   */
  async storefrontCategories({ tenantId }) {
    const counted = await TenantProduct.aggregate([
      { $match: { tenantId: toObjectId(tenantId), status: TENANT_LISTING_STATUS.ACTIVE, isDeleted: { $ne: true }, 'price.sellingPrice': { $ne: null }, 'channels.storefront': { $ne: false } } },
      {
        $lookup: {
          from: 'productmasters', localField: 'productMasterId', foreignField: '_id', as: 'master',
        },
      },
      { $unwind: '$master' },
      {
        $match: {
          'master.status': PRODUCT_MASTER_STATUS.ACTIVE,
          'master.complianceStatus': { $ne: 'pending' },
          'master.isDeleted': { $ne: true },
          'master.categoryId': { $ne: null },
        },
      },
      {
        $group: {
          _id: { categoryId: '$master.categoryId', masterId: '$master._id' },
          fromPrice: { $min: '$price.sellingPrice' },
        },
      },
      {
        $group: {
          _id: '$_id.categoryId',
          productCount: { $sum: 1 },
          fromPrice: { $min: '$fromPrice' },
        },
      },
    ]);
    const direct = new Map(counted.map((r) => [String(r._id), r]));

    const cats = await Category.find({ status: 'active', isDeleted: { $ne: true } })
      .sort({ sortOrder: 1, name: 1 }).lean();
    const nodes = new Map();
    for (const c of cats) {
      const d = direct.get(String(c._id));
      nodes.set(String(c._id), {
        id: c._id,
        parentId: c.parentId || null,
        level: c.level || 0,
        name: c.name,
        slug: c.slug,
        description: c.description || null,
        imageUrl: c.imageUrl || null,
        iconUrl: c.iconUrl || null,
        bannerUrl: c.bannerUrl || null,
        isFeatured: Boolean(c.isFeatured),
        sortOrder: c.sortOrder || 0,
        productCount: d?.productCount || 0,
        totalCount: d?.productCount || 0,
        fromPrice: d?.fromPrice ?? null,
        children: [],
      });
    }
    // Roll up: deepest first, so each parent sees finished children.
    const byLevelDesc = [...nodes.values()].sort((a, b) => b.level - a.level);
    for (const n of byLevelDesc) {
      if (!n.parentId || !nodes.has(String(n.parentId))) continue;
      const p = nodes.get(String(n.parentId));
      p.totalCount += n.totalCount;
      if (n.fromPrice != null && (p.fromPrice == null || n.fromPrice < p.fromPrice)) {
        p.fromPrice = n.fromPrice;
      }
    }
    // Prune dead branches, then nest.
    for (const n of nodes.values()) {
      if (n.totalCount > 0 || direct.has(String(n.id))) continue;
      nodes.delete(String(n.id));
    }
    const tree = [];
    for (const n of nodes.values()) {
      const pid = n.parentId ? String(n.parentId) : null;
      if (pid && nodes.has(pid)) nodes.get(pid).children.push(n);
      else tree.push(n);
    }
    const sortKids = (list) => {
      list.sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
      list.forEach((n) => sortKids(n.children));
    };
    sortKids(tree);
    const flat = [...nodes.values()].map(({ children, ...rest }) => rest);
    return { tree, flat };
  }
}

export default new CatalogSearchService();
