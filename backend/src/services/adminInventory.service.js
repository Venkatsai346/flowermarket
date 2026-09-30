/**
 * AdminInventoryService — inventory health dashboard + append-only stock
 * ledger (Phase 4).
 *
 * adjust() is ATOMIC: a single findOneAndUpdate guards `qtyOnHand + qtyChange
 * >= 0` and bumps `version` (optimistic lock, retry-once), then writes an
 * InventoryAdjustment row (before/after snapshot) + refreshes the
 * TenantProduct.stockQty snapshot + audit. Race-safe under concurrency.
 */

import Inventory from '../models/inventory.model.js';
import InventoryAdjustment from '../models/inventoryAdjustment.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import ProductMaster from '../models/productMaster.model.js';
import Hub from '../models/hub.model.js';
import auditService from './audit.service.js';
import inventoryService from './inventory.service.js';
import warehouseAllocationService from './warehouseAllocation.service.js';
import { serializeList } from '../utils/serialize.js';
import { roundMoney } from '../utils/money.js';
import { notFound, badRequest, conflict } from '../utils/ApiError.js';
import { INVENTORY_ADJUSTMENT_TYPE, INVENTORY_HEALTH, ADMIN_DEFAULTS } from '../constants/enums.js';

const aggregateByListing = (rows, policySafetyStock = 0) => {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = String(row.tenantProductId);
    const current = grouped.get(key) || {
      tenantProductId: row.tenantProductId, qtyOnHand: 0, qtyReserved: 0,
      available: 0, nodeCount: 0, lastUpdatedAt: null,
    };
    current.qtyOnHand += Number(row.qtyOnHand || 0);
    current.qtyReserved += Number(row.qtyReserved || 0);
    if (row.isSellable !== false) {
      current.available += Math.max(0, Number(row.qtyOnHand || 0) - Number(row.qtyReserved || 0)
        - Number(row.safetyStock || 0) - Number(policySafetyStock || 0));
    }
    current.nodeCount += 1;
    if (!current.lastUpdatedAt || row.lastUpdatedAt > current.lastUpdatedAt) current.lastUpdatedAt = row.lastUpdatedAt;
    grouped.set(key, current);
  }
  return grouped;
};

const healthOf = (available, threshold) => {
  if (available <= 0) return INVENTORY_HEALTH.OUT_OF_STOCK;
  if (available <= threshold) return INVENTORY_HEALTH.LOW_STOCK;
  return INVENTORY_HEALTH.IN_STOCK;
};

export class AdminInventoryService {
  /** Whole-dashboard stock health counts. */
  async summary({ tenantId }) {
    const rows = await Inventory.find({ tenantId, isDeleted: { $ne: true } }).lean();
    const listingIds = rows.map((r) => r.tenantProductId);
    const listings = listingIds.length
      ? await TenantProduct.find({ tenantId, _id: { $in: listingIds } }).select('price').lean()
      : [];
    const priceByListing = new Map(listings.map((l) => [String(l._id), l.price?.sellingPrice || 0]));

    const threshold = ADMIN_DEFAULTS.LOW_STOCK_THRESHOLD;
    const policy = await warehouseAllocationService.getPolicy(tenantId);
    const grouped = aggregateByListing(rows, policy.reserveSafetyStock);
    let inStock = 0; let lowStock = 0; let outOfStock = 0;
    let reservedUnits = 0; let onHandValue = 0;
    for (const r of grouped.values()) {
      const avail = r.available;
      const h = healthOf(avail, threshold);
      if (h === INVENTORY_HEALTH.IN_STOCK) inStock += 1;
      else if (h === INVENTORY_HEALTH.LOW_STOCK) lowStock += 1;
      else outOfStock += 1;
      reservedUnits += r.qtyReserved;
      onHandValue += r.qtyOnHand * (priceByListing.get(String(r.tenantProductId)) || 0);
    }
    return {
      totalSku: grouped.size,
      fulfillmentNodes: new Set(rows.map((row) => String(row.warehouseId || 'default'))).size,
      inStock, lowStock, outOfStock,
      reservedUnits,
      onHandValue: roundMoney(onHandValue),
      lowStockThreshold: threshold,
    };
  }

  /** Filterable list (search, categoryId, health) + restock suggestion. */
  async list({ tenantId, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const threshold = query.lowStockThreshold != null && query.lowStockThreshold !== ''
      ? Math.max(0, Number(query.lowStockThreshold))
      : ADMIN_DEFAULTS.LOW_STOCK_THRESHOLD;

    // resolve master ids for search/category first
    let masterIds = null;
    if (query.search || query.categoryId) {
      const mf = { tenantId };
      if (query.categoryId) mf.categoryId = query.categoryId;
      if (query.search) { const rx = new RegExp(query.search, 'i'); mf.$or = [{ title: rx }, { skuGlobal: rx }]; }
      masterIds = (await ProductMaster.find(mf).select('_id').lean()).map((m) => m._id);
      if (!masterIds.length) return { items: [], meta: { page, limit, total: 0, totalPages: 0, hasMore: false } };
    }

    const listingFilter = { tenantId, isDeleted: { $ne: true } };
    if (masterIds) listingFilter.productMasterId = { $in: masterIds };
    const listings = await TenantProduct.find(listingFilter).lean();

    const listingIds = listings.map((l) => l._id);
    const invs = listingIds.length
      ? await Inventory.find({ tenantId, tenantProductId: { $in: listingIds }, isDeleted: { $ne: true } }).lean()
      : [];
    const policy = await warehouseAllocationService.getPolicy(tenantId);
    const invByListing = aggregateByListing(invs, policy.reserveSafetyStock);
    const masterIdsSet = [...new Set(listings.map((l) => String(l.productMasterId)))];
    const masters = masterIdsSet.length
      ? await ProductMaster.find({ tenantId, _id: { $in: masterIdsSet } }).lean()
      : [];
    const masterById = new Map(masters.map((m) => [String(m._id), m]));

    const rows = listings.map((l) => {
      const inv = invByListing.get(String(l._id));
      const available = inv?.available || 0;
      const health = healthOf(available, threshold);
      const master = masterById.get(String(l.productMasterId)) || {};
      return {
        listingId: l._id,
        skuGlobal: master.skuGlobal || null,
        title: master.title || l.titleSnapshot || 'Item',
        categoryId: master.categoryId || null,
        listingStatus: l.status,
        price: l.price || null,
        qtyOnHand: inv?.qtyOnHand ?? 0,
        qtyReserved: inv?.qtyReserved ?? 0,
        available,
        fulfillmentNodeCount: inv?.nodeCount || 0,
        health,
        restockSuggestion: health === INVENTORY_HEALTH.OUT_OF_STOCK ? threshold : health === INVENTORY_HEALTH.LOW_STOCK ? (threshold - available + 5) : 0,
        lastUpdatedAt: inv?.lastUpdatedAt || l.updatedAt,
      };
    });

    let filtered = rows;
    if (query.health) filtered = filtered.filter((r) => r.health === query.health);
    const total = filtered.length;
    const items = filtered.slice((page - 1) * limit, page * limit);

    return { items: serializeList(items), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total } };
  }

  /** Stock ledger for one listing: current state + append-only adjustments. */
  async ledger({ tenantId, listingId }) {
    const listing = await TenantProduct.findOne({ _id: listingId, tenantId }).lean();
    if (!listing) throw notFound('Listing not found', 'LISTING_NOT_FOUND');
    const policy = await warehouseAllocationService.getPolicy(tenantId);
    const [inventories, adjustments, hubs] = await Promise.all([
      Inventory.find({ tenantId, tenantProductId: listingId }).lean(),
      InventoryAdjustment.find({ tenantId, tenantProductId: listingId }).sort({ createdAt: -1 }).limit(200).lean(),
      Hub.find({ tenantId }).select('name code').lean(),
    ]);
    const hubById = new Map(hubs.map((hub) => [String(hub._id), hub]));
    const aggregate = [...aggregateByListing(inventories, policy.reserveSafetyStock).values()][0] || null;
    return {
      listing: { id: listing._id, skuSnapshot: listing.skuSnapshot || null },
      inventory: aggregate ? {
        qtyOnHand: aggregate.qtyOnHand, qtyReserved: aggregate.qtyReserved,
        available: aggregate.available, nodeCount: aggregate.nodeCount, lastUpdatedAt: aggregate.lastUpdatedAt,
      } : null,
      nodes: inventories.map((row) => ({
        id: row._id,
        warehouseId: row.warehouseId || null,
        warehouseName: row.warehouseId ? hubById.get(String(row.warehouseId))?.name || 'Unknown hub' : 'Legacy default pool',
        warehouseCode: row.warehouseId ? hubById.get(String(row.warehouseId))?.code || '—' : 'DEFAULT',
        qtyOnHand: row.qtyOnHand || 0, qtyReserved: row.qtyReserved || 0,
        safetyStock: row.safetyStock || 0,
        policySafetyStock: policy.reserveSafetyStock || 0,
        available: Math.max(0, (row.qtyOnHand || 0) - (row.qtyReserved || 0)
          - (row.safetyStock || 0) - (policy.reserveSafetyStock || 0)),
        isSellable: row.isSellable !== false, version: row.version, lastUpdatedAt: row.lastUpdatedAt,
      })),
      adjustments: serializeList(adjustments),
    };
  }

  /**
   * ATOMIC manual adjustment (admin dashboard).
   * @returns {{inventory, adjustment}}
   */
  async adjust({ tenantId, listingId, type, qtyChange, reason, note = null, warehouseId = null, actorId = null, req = null }) {
    if (!Object.values(INVENTORY_ADJUSTMENT_TYPE).includes(type)) {
      throw badRequest('Invalid adjustment type', 'INVALID_ADJUSTMENT_TYPE');
    }
    qtyChange = Math.trunc(Number(qtyChange));
    if (!Number.isFinite(qtyChange) || qtyChange === 0) {
      throw badRequest('qtyChange must be a non-zero integer', 'INVALID_QTY_CHANGE');
    }

    const listing = await TenantProduct.findOne({ _id: listingId, tenantId });
    if (!listing) throw notFound('Listing not found', 'LISTING_NOT_FOUND');
    const row = await Inventory.findOne({ tenantId, tenantProductId: listingId, warehouseId: warehouseId || null });
    if (!row) throw notFound('Inventory row not found', 'INVENTORY_NOT_FOUND');

    // ---- atomic update with non-negative guard + optimistic version lock ----
    let updated = null;
    for (let attempt = 0; attempt < 2 && !updated; attempt += 1) {
      updated = await Inventory.findOneAndUpdate(
        {
          _id: row._id,
          version: row.version, // optimistic lock — retry once on conflict
          $expr: { $gte: [{ $add: ['$qtyOnHand', qtyChange] }, 0] },
        },
        { $inc: { qtyOnHand: qtyChange, version: 1 }, $set: { lastUpdatedAt: new Date() } },
        { new: true }
      );
      if (!updated && attempt === 0) {
        const fresh = await Inventory.findById(row._id);
        if (fresh) row.version = fresh.version; // refetch fresh version for the retry
      }
    }
    if (!updated) {
      throw conflict('Adjustment would make stock negative or the row changed concurrently', 'INVALID_QTY');
    }

    // ---- append-only ledger row (before/after snapshot) ----
    const adjustment = await InventoryAdjustment.create({
      tenantId,
      inventoryId: row._id,
      tenantProductId: listingId,
      warehouseId: warehouseId || null,
      type,
      qtyChange,
      qtyBefore: updated.qtyOnHand - qtyChange,
      qtyAfter: updated.qtyOnHand,
      reason,
      note: note || null,
      actorId: actorId || null,
      actorType: 'admin',
    });

    // Refresh the network aggregate, never overwrite it with one node's stock.
    await inventoryService.refreshListingStock(listing);

    await auditService.record({
      action: 'adjust', entityType: 'inventory', entityId: listingId,
      tenantId, actorId, actorType: 'admin',
      before: { qtyOnHand: updated.qtyOnHand - qtyChange },
      after: { qtyOnHand: updated.qtyOnHand },
      meta: { type, reason, adjustmentId: adjustment._id }, req,
    });

    return { inventory: updated, adjustment };
  }

  /** CSV snapshot of the inventory view. */
  async csv({ tenantId, query = {} }) {
    const { items } = await this.list({ tenantId, query: { ...query, page: 1, limit: 200 } });
    return items.map((r) => ({
      listingId: r.listingId, skuGlobal: r.skuGlobal, title: r.title,
      mrp: r.price?.mrp ?? '', sellingPrice: r.price?.sellingPrice ?? '',
      qtyOnHand: r.qtyOnHand, qtyReserved: r.qtyReserved, available: r.available,
      health: r.health, restockSuggestion: r.restockSuggestion,
    }));
  }
}

export default new AdminInventoryService();
