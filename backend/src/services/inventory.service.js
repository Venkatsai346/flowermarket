import Inventory from '../models/inventory.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import PriceHistory from '../models/priceHistory.model.js'; // eslint-disable-line no-unused-vars
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import deriveAvailability from '../utils/catalog/availability.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { TENANT_LISTING_STATUS, INVENTORY_OP_TYPE } from '../constants/enums.js';

/**
 * InventoryService — stock truth + atomic reservation/release.
 *
 * Business rules:
 *  - One Inventory row per (tenant, listing, warehouse); null warehouse = default.
 *  - qtyAvailable = qtyOnHand - qtyReserved (never negative).
 *  - reserve/release are ATOMIC (findOneAndUpdate with a guard filter) so two
 *    concurrent carts can never over-reserve.
 *  - TenantProduct.stockQty + availability are refreshed (denormalized) so
 *    customer reads are one cheap query.
 *  - InventoryLedger-style detail lives in AuditLog entries (STOCK_CHANGE).
 */
class InventoryService {
  async getRow({ tenantId, listingId, warehouseId = null, createIfMissing = false }) {
    let row = await Inventory.findOne({ tenantId, tenantProductId: listingId, warehouseId: warehouseId || null });
    if (!row && createIfMissing) {
      row = await Inventory.create({
        tenantId, tenantProductId: listingId, warehouseId: warehouseId || null,
        qtyOnHand: 0, qtyReserved: 0, lastUpdatedAt: new Date(),
      });
    }
    return row;
  }

  /** Set absolute on-hand quantity (manual stock-count). */
  async setStock({ tenantId, listingId, qty, warehouseId = null, actorId = null, req = null }) {
    const listing = await TenantProduct.findOne({ _id: listingId, tenantId });
    if (!listing) throw notFound('Listing not found', 'LISTING_NOT_FOUND');
    if (qty < 0) throw badRequest('Quantity cannot be negative', 'INVALID_QTY');

    const row = await this.getRow({ tenantId, listingId, warehouseId, createIfMissing: true });
    const before = row.qtyOnHand;
    row.qtyOnHand = qty;
    row.lastUpdatedAt = new Date();
    await row.save();

    await this.refreshListingStock(listing, row);
    await this.logOp({ tenantId, listingId, op: INVENTORY_OP_TYPE.ADJUSTMENT, qty, before, after: qty, actorId, req });
    return row;
  }

  /** Signed adjustment (delta). */
  async adjustStock({ tenantId, listingId, delta, warehouseId = null, actorId = null, req = null }) {
    const listing = await TenantProduct.findOne({ _id: listingId, tenantId });
    if (!listing) throw notFound('Listing not found', 'LISTING_NOT_FOUND');
    const row = await this.getRow({ tenantId, listingId, warehouseId, createIfMissing: true });
    const next = row.qtyOnHand + Number(delta);
    if (next < 0) throw badRequest('Adjustment would make stock negative', 'INVALID_QTY');

    const before = row.qtyOnHand;
    row.qtyOnHand = next;
    row.lastUpdatedAt = new Date();
    await row.save();

    await this.refreshListingStock(listing, row);
    await this.logOp({ tenantId, listingId, op: INVENTORY_OP_TYPE.ADJUSTMENT, delta, before, after: next, actorId, req });
    return row;
  }

  /**
   * ATOMIC reserve: only succeeds if qtyReserved + qty <= qtyOnHand.
   * Uses findOneAndUpdate with the guard in the filter — race-safe.
   */
  async reserve({ tenantId, listingId, qty, orderRef = null, warehouseId = null, actorId = null, req = null }) {
    if (!Number.isInteger(qty) || qty <= 0) throw badRequest('Reserve quantity must be a positive integer', 'INVALID_QTY');

    const row = await Inventory.findOneAndUpdate(
      {
        tenantId,
        tenantProductId: listingId,
        warehouseId: warehouseId || null,
        $expr: { $lte: [{ $add: ['$qtyReserved', qty] }, '$qtyOnHand'] },
      },
      { $inc: { qtyReserved: qty }, $set: { lastUpdatedAt: new Date() } },
      { new: true }
    );

    if (!row) {
      // distinguish "no row" vs "insufficient stock"
      const exists = await Inventory.exists({ tenantId, tenantProductId: listingId, warehouseId: warehouseId || null });
      if (!exists) throw notFound('No inventory row for this listing', 'INVENTORY_NOT_FOUND');
      throw conflict('Insufficient stock to reserve', 'INSUFFICIENT_STOCK');
    }

    const listing = await TenantProduct.findOne({ _id: listingId, tenantId });
    if (listing) await this.refreshListingStock(listing, row);

    await this.logOp({
      tenantId, listingId, op: INVENTORY_OP_TYPE.SALE, qty, before: row.qtyReserved - qty,
      after: row.qtyReserved, actorId, req, meta: { orderRef, action: 'reserve' },
    });
    await catalogEventService.publish({
      eventType: 'inventory_reserved', entityType: 'inventory', entityId: row.id,
      tenantId, payload: { listingId, qty, orderRef },
    });
    return row;
  }

  /** ATOMIC release of a reservation. */
  async release({ tenantId, listingId, qty, orderRef = null, warehouseId = null, actorId = null, req = null }) {
    if (!Number.isInteger(qty) || qty <= 0) throw badRequest('Release quantity must be a positive integer', 'INVALID_QTY');

    const row = await Inventory.findOneAndUpdate(
      {
        tenantId,
        tenantProductId: listingId,
        warehouseId: warehouseId || null,
        qtyReserved: { $gte: qty },
      },
      { $inc: { qtyReserved: -qty }, $set: { lastUpdatedAt: new Date() } },
      { new: true }
    );

    if (!row) {
      const exists = await Inventory.exists({ tenantId, tenantProductId: listingId, warehouseId: warehouseId || null });
      if (!exists) throw notFound('No inventory row for this listing', 'INVENTORY_NOT_FOUND');
      throw conflict('Cannot release more than reserved', 'INSUFFICIENT_RESERVATION');
    }

    const listing = await TenantProduct.findOne({ _id: listingId, tenantId });
    if (listing) await this.refreshListingStock(listing, row);

    await this.logOp({
      tenantId, listingId, op: INVENTORY_OP_TYPE.RETURN, qty: -qty, before: row.qtyReserved + qty,
      after: row.qtyReserved, actorId, req, meta: { orderRef, action: 'release' },
    });
    await catalogEventService.publish({
      eventType: 'inventory_released', entityType: 'inventory', entityId: row.id,
      tenantId, payload: { listingId, qty, orderRef },
    });
    return row;
  }

  async getStock({ tenantId, listingId, warehouseId = null }) {
    const row = await this.getRow({ tenantId, listingId, warehouseId });
    if (!row) return { qtyOnHand: 0, qtyReserved: 0, qtyAvailable: 0 };
    return row.toObject();
  }

  async bulkGetStock({ tenantId, listingIds }) {
    const rows = await Inventory.find({ tenantId, tenantProductId: { $in: listingIds } }).lean();
    const map = {};
    for (const r of rows) {
      map[String(r.tenantProductId)] = {
        qtyOnHand: r.qtyOnHand,
        qtyReserved: r.qtyReserved,
        qtyAvailable: Math.max(0, r.qtyOnHand - r.qtyReserved),
      };
    }
    return map;
  }

  /**
   * HARD COMMIT (post-payment) — atomically deduct qtyOnHand for many items.
   * Returns { committed: [...], failed: [{listingId, reason}] }. If ANY item
   * fails, the caller must compensate (restore committed + refund).
   * The guard `$expr qtyOnHand >= qty` makes the final stock race safe.
   */
  async commitForOrder({ tenantId, items }) {
    const committed = [];
    const failed = [];
    for (const it of items) {
      const row = await Inventory.findOneAndUpdate(
        {
          tenantId,
          tenantProductId: it.listingId,
          $expr: { $gte: ['$qtyOnHand', it.qty] },
        },
        { $inc: { qtyOnHand: -it.qty }, $set: { lastUpdatedAt: new Date() } },
        { new: true }
      );
      if (row) {
        committed.push({ listingId: it.listingId, qty: it.qty, row });
        const listing = await TenantProduct.findOne({ _id: it.listingId, tenantId });
        if (listing) await this.refreshListingStock(listing, row);
      } else {
        failed.push({ listingId: it.listingId, qty: it.qty, reason: 'insufficient_stock' });
      }
    }
    return { committed, failed };
  }

  /** COMPENSATION — restore qtyOnHand for items that were committed. */
  async restoreForOrder({ tenantId, items }) {
    for (const it of items) {
      const row = await Inventory.findOneAndUpdate(
        { tenantId, tenantProductId: it.listingId },
        { $inc: { qtyOnHand: it.qty }, $set: { lastUpdatedAt: new Date() } },
        { new: true }
      );
      if (row) {
        const listing = await TenantProduct.findOne({ _id: it.listingId, tenantId });
        if (listing) await this.refreshListingStock(listing, row);
      }
    }
    return { restored: items.length };
  }

  // ---------------- helpers ----------------

  /** Refresh the denormalized stockQty + availability on the tenant listing. */
  async refreshListingStock(listing, row) {
    const stock = row.qtyOnHand - row.qtyReserved;
    const availability = deriveAvailability(stock);
    const patch = {
      stockQty: Math.max(0, stock),
      'availability.status': availability,
      'availability.updatedAt': new Date(),
      lastStockChangedAt: new Date(),
    };
    // auto out-of-stock only when active; keep status transitions explicit otherwise
    await TenantProduct.updateOne({ _id: listing._id }, { $set: patch });
    if (stock === 0 && listing.status === TENANT_LISTING_STATUS.ACTIVE) {
      await TenantProduct.updateOne(
        { _id: listing._id },
        { $set: { status: TENANT_LISTING_STATUS.OUT_OF_STOCK, lastStatusChangedAt: new Date() } }
      );
    }
  }

  async logOp({ tenantId, listingId, op, qty, delta, before, after, actorId, req, meta = null }) {
    await auditService.record({
      action: 'stock_change', entityType: 'inventory', entityId: listingId,
      tenantId, actorId, actorType: actorId ? 'tenant' : 'system',
      before: { qtyOnHand: before }, after: { qtyOnHand: after },
      meta: { op, qty, delta, ...meta }, req,
    });
  }
}

export default new InventoryService();
