/**
 * AdminCatalogService — read-side dashboard views over the catalog
 * (Phase 4). Writes stay in the Phase-2 catalog admin surface; this service
 * only joins masters → listings → inventory for the admin dashboard + CSV.
 *
 * `list()` is a SINGLE Mongo aggregation (no in-memory joins): listings are
 * grouped per master in-database, then masters + the primary listing's
 * inventory are $lookup-ed. The whole tenant catalogue is scanned by index,
 * but only the GROUPED (one row per master) set is projected/sorted/paginated
 * — memory stays O(masters) regardless of listing count.
 *
 * "Primary listing" per master: the OLDEST listing (deterministic — the
 * original master-level row), whose price is presented as the master's.
 */

import ProductMaster from '../models/productMaster.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import Inventory from '../models/inventory.model.js';
import PriceHistory from '../models/priceHistory.model.js';
import mongoose from 'mongoose';
import { serializeList } from '../utils/serialize.js';
import { literalRegex } from '../utils/regex.js';
import { INVENTORY_HEALTH } from '../constants/enums.js';

const healthOf = (inv) => {
  const avail = Math.max(0, (inv?.qtyOnHand || 0) - (inv?.qtyReserved || 0));
  if (avail <= 0) return INVENTORY_HEALTH.OUT_OF_STOCK;
  return INVENTORY_HEALTH.IN_STOCK; // low-stock is decided by the caller's threshold
};

const toObjectId = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(v));

export class AdminCatalogService {
  /**
   * Master-level list joined with listing + inventory — one aggregation.
   * Filters: search (title/sku), categoryId, status (master), health,
   * lowStockThreshold, pagination.
   */
  async list({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const threshold = query.lowStockThreshold != null && query.lowStockThreshold !== ''
      ? Math.max(0, Number(query.lowStockThreshold))
      : 5;

    const pipeline = [
      { $match: { tenantId: toObjectId(tenantId), isDeleted: { $ne: true } } },
      { $lookup: { from: 'productmasters', localField: 'productMasterId', foreignField: '_id', as: 'master' } },
      { $unwind: { path: '$master', preserveNullAndEmptyArrays: false } },
      // updateMany/aggregate lookups are not soft-delete-filtered — explicit.
      { $match: { 'master.isDeleted': { $ne: true } } },
    ];
    if (query.categoryId) pipeline.push({ $match: { 'master.categoryId': toObjectId(query.categoryId) } });
    if (query.status) pipeline.push({ $match: { 'master.status': query.status } });
    if (query.search) {
      const rx = literalRegex(query.search); // escaped — raw input never reaches new RegExp
      pipeline.push({ $match: { $or: [{ 'master.title': rx }, { 'master.skuGlobal': rx }] } });
    }
    // Deterministic primary per master: oldest listing first.
    pipeline.push({ $sort: { createdAt: 1 } });
    pipeline.push({
      $group: {
        _id: '$productMasterId',
        listingsCount: { $sum: 1 },
        primaryListingId: { $first: '$_id' },
        primaryPrice: { $first: '$price' },
        updatedAt: { $max: { $ifNull: ['$master.updatedAt', '$updatedAt'] } },
      },
    });
    pipeline.push({ $lookup: { from: 'productmasters', localField: '_id', foreignField: '_id', as: 'master' } });
    pipeline.push({ $unwind: { path: '$master', preserveNullAndEmptyArrays: false } });
    pipeline.push({ $lookup: { from: 'inventories', localField: 'primaryListingId', foreignField: 'tenantProductId', as: 'inv' } });
    pipeline.push({ $unwind: { path: '$inv', preserveNullAndEmptyArrays: true } });
    pipeline.push({
      $addFields: {
        qtyOnHand: { $ifNull: ['$inv.qtyOnHand', 0] },
        qtyReserved: { $ifNull: ['$inv.qtyReserved', 0] },
        available: {
          $max: [0, { $subtract: [{ $ifNull: ['$inv.qtyOnHand', 0] }, { $ifNull: ['$inv.qtyReserved', 0] }] }],
        },
      },
    });
    pipeline.push({
      $addFields: {
        health: {
          $switch: {
            branches: [
              { case: { $lte: ['$available', 0] }, then: INVENTORY_HEALTH.OUT_OF_STOCK },
              { case: { $lte: ['$available', threshold] }, then: INVENTORY_HEALTH.LOW_STOCK },
            ],
            default: INVENTORY_HEALTH.IN_STOCK,
          },
        },
      },
    });
    if (query.health) pipeline.push({ $match: { health: query.health } });
    pipeline.push({ $sort: { updatedAt: -1 } });

    const [facet] = await TenantProduct.aggregate([
      ...pipeline,
      {
        $facet: {
          items: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                id: { $toString: '$_id' },
                skuGlobal: '$master.skuGlobal',
                title: '$master.title',
                type: '$master.type',
                categoryId: '$master.categoryId',
                status: '$master.status',
                listingsCount: 1,
                listingId: { $toString: '$primaryListingId' },
                price: '$primaryPrice',
                stock: {
                  qtyOnHand: '$qtyOnHand',
                  qtyReserved: '$qtyReserved',
                  available: '$available',
                  health: '$health',
                },
                updatedAt: 1,
              },
            },
          ],
          total: [{ $count: 'total' }],
        },
      },
    ]);

    const items = facet?.items || [];
    const total = facet?.total?.[0]?.total ?? 0;
    return {
      // items already carry string ids — skip serializeList (it would clobber
      // id with String(undefined) on these synthesized rows)
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total },
    };
  }

  /** Master detail: master + listings + per-listing inventory + price history. */
  async detail({ tenantId, id }) {
    const listings = await TenantProduct.find({ tenantId, productMasterId: id, isDeleted: { $ne: true } }).lean();
    if (!listings.length) throw new (await import('../utils/ApiError.js')).notFound('Master not found for this tenant', 'MASTER_NOT_FOUND');
    const master = await ProductMaster.findOne({ _id: id }).lean();
    if (!master) throw new (await import('../utils/ApiError.js')).notFound('Master not found', 'MASTER_NOT_FOUND');

    const listingIds = listings.map((l) => l._id);
    const invs = listingIds.length
      ? await Inventory.find({ tenantId, tenantProductId: { $in: listingIds } }).lean()
      : [];
    const invByListing = new Map(invs.map((i) => [String(i.tenantProductId), i]));
    const priceHistory = await PriceHistory.find({ tenantId, tenantProductId: { $in: listingIds } })
      .sort({ createdAt: -1 }).limit(50).lean();

    const enriched = listings.map((l) => {
      const inv = invByListing.get(String(l._id));
      const available = Math.max(0, (inv?.qtyOnHand || 0) - (inv?.qtyReserved || 0));
      return {
        ...l,
        id: l._id,
        inventory: inv ? {
          qtyOnHand: inv.qtyOnHand, qtyReserved: inv.qtyReserved,
          available, health: healthOf(inv),
        } : { qtyOnHand: 0, qtyReserved: 0, available: 0, health: INVENTORY_HEALTH.OUT_OF_STOCK },
      };
    });

    return { master: { ...master, id: master._id }, listings: serializeList(enriched), priceHistory: serializeList(priceHistory) };
  }

  /**
   * CSV export of the same view — COMPLETE, not truncated: pages through the
   * aggregated list until exhausted (hard safety cap: 50 pages × 200 = 10k
   * rows, with an `exportComplete: false` marker if the cap was hit).
   */
  async csv({ tenantId, query = {} }) {
    const rows = [];
    const PAGE = 200;
    const MAX_PAGES = 50;
    let page = 1;
    let complete = true;
    while (true) {
      // Export pagination is deliberately sequential because each bounded page depends on the previous cursor.
      // eslint-disable-next-line no-await-in-loop
      const { items, meta } = await this.list({ tenantId, query: { ...query, page, limit: PAGE } });
      rows.push(...items);
      if (!meta.hasMore || page >= MAX_PAGES) {
        if (meta.hasMore) complete = false;
        break;
      }
      page += 1;
    }
    const mapped = rows.map((it) => ({
      id: it.id,
      skuGlobal: it.skuGlobal,
      title: it.title,
      type: it.type,
      categoryId: it.categoryId,
      status: it.status,
      mrp: it.price?.mrp ?? '',
      sellingPrice: it.price?.sellingPrice ?? '',
      qtyOnHand: it.stock.qtyOnHand,
      qtyReserved: it.stock.qtyReserved,
      available: it.stock.available,
      health: it.stock.health,
    }));
    return { rows: mapped, exportComplete: complete };
  }
}

export default new AdminCatalogService();
