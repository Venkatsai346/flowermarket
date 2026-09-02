/**
 * AdminCatalogService — read-side dashboard views over the catalog
 * (Phase 4). Writes stay in the Phase-2 catalog admin surface; this service
 * only joins masters → listings → inventory for the admin dashboard + CSV.
 */

import ProductMaster from '../models/productMaster.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import Inventory from '../models/inventory.model.js';
import PriceHistory from '../models/priceHistory.model.js';
import Category from '../models/category.model.js';
import { serializeList } from '../utils/serialize.js';
import { INVENTORY_HEALTH } from '../constants/enums.js';

const healthOf = (inv) => {
  const avail = Math.max(0, (inv?.qtyOnHand || 0) - (inv?.qtyReserved || 0));
  if (avail <= 0) return INVENTORY_HEALTH.OUT_OF_STOCK;
  return INVENTORY_HEALTH.IN_STOCK; // low-stock is decided by the caller's threshold
};

export class AdminCatalogService {
  /**
   * Master-level list joined with listing + inventory.
   * NOTE: ProductMaster is the SHARED catalog (no tenantId) — the tenant
   * scope comes from TenantProduct. So we resolve listings first, then their
   * masters (like the customer catalog does).
   * Filters: search (title/sku), categoryId, status, health, threshold, pagination.
   */
  async list({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const threshold = query.lowStockThreshold != null && query.lowStockThreshold !== ''
      ? Math.max(0, Number(query.lowStockThreshold))
      : 5;

    // ---- tenant-scoped listings first ----
    const listingFilter = { tenantId, isDeleted: { $ne: true } };
    if (query.categoryId) {
      const masterIds = (await ProductMaster.find({ categoryId: query.categoryId }).select('_id').lean()).map((m) => m._id);
      if (!masterIds.length) return { items: [], meta: { page, limit, total: 0, totalPages: 0, hasMore: false } };
      listingFilter.productMasterId = { $in: masterIds };
    }
    let listings = await TenantProduct.find(listingFilter).lean();
    if (query.search) {
      const rx = new RegExp(query.search, 'i');
      const masterIds = (await ProductMaster.find({ $or: [{ title: rx }, { skuGlobal: rx }] }).select('_id').lean()).map((m) => m._id);
      const listingIds = (await TenantProduct.find({ tenantId, productMasterId: { $in: masterIds } }).select('_id').lean()).map((l) => l._id);
      listings = listings.filter((l) => listingIds.includes(String(l._id)));
    }

    // ---- masters for those listings (shared catalog) ----
    const masterIds = [...new Set(listings.map((l) => String(l.productMasterId)).filter(Boolean))];
    const masters = masterIds.length
      ? await ProductMaster.find({ _id: { $in: masterIds } }).lean()
      : [];
    const masterById = new Map(masters.map((m) => [String(m._id), m]));

    // ---- inventory per listing ----
    const listingIds = listings.map((l) => l._id);
    const invs = listingIds.length
      ? await Inventory.find({ tenantId, tenantProductId: { $in: listingIds }, isDeleted: { $ne: true } }).lean()
      : [];
    const invByListing = new Map(invs.map((i) => [String(i.tenantProductId), i]));

    // ---- group listings per master, pick primary ----
    const byMaster = new Map();
    for (const l of listings) {
      const arr = byMaster.get(String(l.productMasterId)) || [];
      arr.push(l);
      byMaster.set(String(l.productMasterId), arr);
    }

    const items = [];
    for (const [masterId, ls] of byMaster) {
      const m = masterById.get(masterId) || {};
      const primary = ls[0];
      const inv = invByListing.get(String(primary._id));
      const available = Math.max(0, (inv?.qtyOnHand || 0) - (inv?.qtyReserved || 0));
      const health = available <= 0 ? INVENTORY_HEALTH.OUT_OF_STOCK : available <= threshold ? INVENTORY_HEALTH.LOW_STOCK : INVENTORY_HEALTH.IN_STOCK;

      if (query.health && query.health !== health) continue;

      items.push({
        id: masterId,
        skuGlobal: m.skuGlobal || null,
        title: m.title || primary.skuSnapshot?.title || 'Item',
        type: m.type || null,
        categoryId: m.categoryId || null,
        status: m.status || primary.status,
        listingsCount: ls.length,
        listingId: primary._id,
        price: primary.price || null,
        stock: { qtyOnHand: inv?.qtyOnHand ?? 0, qtyReserved: inv?.qtyReserved ?? 0, available, health },
        updatedAt: m.updatedAt || primary.updatedAt,
      });
    }

    const total = items.length;
    const pageItems = items.slice((page - 1) * limit, page * limit);
    return {
      // items already carry string ids — skip serializeList (it would clobber
      // id with String(undefined) on these synthesized rows)
      items: pageItems,
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

  /** CSV export of the same view (bigger limit, no pagination meta). */
  async csv({ tenantId, query = {} }) {
    const { items } = await this.list({ tenantId, query: { ...query, page: 1, limit: 200 } });
    return items.map((it) => ({
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
  }
}

export default new AdminCatalogService();
