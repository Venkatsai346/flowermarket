import Inventory from '../models/inventory.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import PriceHistory from '../models/priceHistory.model.js'; // eslint-disable-line no-unused-vars
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import deriveAvailability from '../utils/catalog/availability.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { TENANT_LISTING_STATUS, INVENTORY_OP_TYPE } from '../constants/enums.js';

const defaultWarehouse = (warehouseId) => warehouseId || null;

function availableOf(row) {
  const onHand = Number(row?.qtyOnHand) || 0;
  const reserved = Number(row?.qtyReserved) || 0;
  return Math.max(0, onHand - reserved);
}

function shapeStock(row) {
  if (!row) return { qtyOnHand: 0, qtyReserved: 0, qtyAvailable: 0 };
  const plain = typeof row.toObject === 'function' ? row.toObject() : { ...row };
  const qtyOnHand = Number(plain.qtyOnHand) || 0;
  const qtyReserved = Number(plain.qtyReserved) || 0;
  return { ...plain, qtyOnHand, qtyReserved, qtyAvailable: Math.max(0, qtyOnHand - qtyReserved) };
}

/**
 * InventoryService — stock truth + atomic reservation/release/commit.
 *
 * qtyAvailable = qtyOnHand - qtyReserved (never negative).
 * Cart add/update RESERVES; checkout COMMITS (on-hand down, reserved down);
 * cancel after confirm RESTORES on-hand only.
 */
class InventoryService {
  async getRow({ tenantId, listingId, warehouseId = null, createIfMissing = false }) {
    const wid = defaultWarehouse(warehouseId);
    let row = await Inventory.findOne({ tenantId, tenantProductId: listingId, warehouseId: wid });
    if (!row && createIfMissing) {
      row = await Inventory.create({
        tenantId, tenantProductId: listingId, warehouseId: wid,
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
    await this.publishStock(listing, row);
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
    await this.publishStock(listing, row);
    return row;
  }

  /**
   * ATOMIC reserve: only succeeds if qtyReserved + qty <= qtyOnHand.
   * Uses findOneAndUpdate with the guard in the filter — race-safe.
   */
  async reserve({ tenantId, listingId, qty, orderRef = null, warehouseId = null, actorId = null, req = null }) {
    if (!Number.isInteger(qty) || qty <= 0) throw badRequest('Reserve quantity must be a positive integer', 'INVALID_QTY');
    const wid = defaultWarehouse(warehouseId);

    const row = await Inventory.findOneAndUpdate(
      {
        tenantId,
        tenantProductId: listingId,
        warehouseId: wid,
        $expr: { $lte: [{ $add: ['$qtyReserved', qty] }, '$qtyOnHand'] },
      },
      { $inc: { qtyReserved: qty }, $set: { lastUpdatedAt: new Date() } },
      { new: true }
    );

    if (!row) {
      const exists = await Inventory.exists({ tenantId, tenantProductId: listingId, warehouseId: wid });
      if (!exists) throw notFound('No inventory row for this listing', 'INVENTORY_NOT_FOUND');
      throw conflict('Insufficient stock to reserve', 'INSUFFICIENT_STOCK');
    }

    const listing = await TenantProduct.findOne({ _id: listingId, tenantId });
    if (listing) {
      await this.refreshListingStock(listing, row);
      await this.publishStock(listing, row);
    }

    await this.logOp({
      tenantId, listingId, op: INVENTORY_OP_TYPE.SALE, qty, before: row.qtyReserved - qty,
      after: row.qtyReserved, actorId, req, meta: { orderRef, action: 'reserve' },
    });
    return row;
  }

  /** ATOMIC release of a reservation. */
  async release({ tenantId, listingId, qty, orderRef = null, warehouseId = null, actorId = null, req = null }) {
    if (!Number.isInteger(qty) || qty <= 0) throw badRequest('Release quantity must be a positive integer', 'INVALID_QTY');
    const wid = defaultWarehouse(warehouseId);

    const row = await Inventory.findOneAndUpdate(
      {
        tenantId,
        tenantProductId: listingId,
        warehouseId: wid,
        qtyReserved: { $gte: qty },
      },
      { $inc: { qtyReserved: -qty }, $set: { lastUpdatedAt: new Date() } },
      { new: true }
    );

    if (!row) {
      const exists = await Inventory.exists({ tenantId, tenantProductId: listingId, warehouseId: wid });
      if (!exists) throw notFound('No inventory row for this listing', 'INVENTORY_NOT_FOUND');
      throw conflict('Cannot release more than reserved', 'INSUFFICIENT_RESERVATION');
    }

    const listing = await TenantProduct.findOne({ _id: listingId, tenantId });
    if (listing) {
      await this.refreshListingStock(listing, row);
      await this.publishStock(listing, row);
    }

    await this.logOp({
      tenantId, listingId, op: INVENTORY_OP_TYPE.RETURN, qty: -qty, before: row.qtyReserved + qty,
      after: row.qtyReserved, actorId, req, meta: { orderRef, action: 'release' },
    });
    return row;
  }

  /**
   * Move reserved qty from `fromQty` to `toQty` (cart add/update/remove).
   * No-op when equal. Best-effort release never throws — a missing reservation
   * must not block removing an item from the basket.
   */
  async syncReservation({ tenantId, listingId, fromQty, toQty, warehouseId = null }) {
    const from = Math.max(0, Math.trunc(Number(fromQty) || 0));
    const to = Math.max(0, Math.trunc(Number(toQty) || 0));
    if (to === from) return { from, to, delta: 0 };
    if (to > from) {
      await this.reserve({ tenantId, listingId, qty: to - from, warehouseId });
    } else {
      await this.release({ tenantId, listingId, qty: from - to, warehouseId }).catch(() => {});
    }
    return { from, to, delta: to - from };
  }

  async getStock({ tenantId, listingId, warehouseId = null }) {
    const row = await this.getRow({ tenantId, listingId, warehouseId });
    return shapeStock(row);
  }

  async bulkGetStock({ tenantId, listingIds }) {
    const ids = (listingIds || []).filter(Boolean);
    if (!ids.length) return {};
    const rows = await Inventory.find({ tenantId, tenantProductId: { $in: ids } }).lean();
    const map = {};
    for (const r of rows) {
      map[String(r.tenantProductId)] = {
        qtyOnHand: r.qtyOnHand,
        qtyReserved: r.qtyReserved,
        qtyAvailable: availableOf(r),
      };
    }
    return map;
  }

  /** Patch catalogue/search rows with live available qty (never stale index). */
  async overlayLiveStock({ tenantId, items }) {
    if (!items?.length) return items;
    const ids = items.map((i) => i.listingId).filter(Boolean);
    const map = await this.bulkGetStock({ tenantId, listingIds: ids });
    for (const it of items) {
      const s = map[String(it.listingId)];
      if (!s) continue;
      it.stockQty = s.qtyAvailable;
      it.availability = {
        ...(it.availability || {}),
        status: s.qtyAvailable > 0 ? 'in_stock' : 'out_of_stock',
        updatedAt: new Date(),
      };
    }
    return items;
  }

  /**
   * HARD COMMIT (post-payment) — deduct qtyOnHand and consume the cart
   * reservation (qtyReserved floors at 0 so a legacy unreserved cart still
   * commits). Guard `$expr qtyOnHand >= qty` is the final stock race.
   */
  async commitForOrder({ tenantId, items }) {
    const committed = [];
    const failed = [];
    for (const it of items) {
      const qty = Math.trunc(Number(it.qty) || 0);
      if (qty <= 0) {
        failed.push({ listingId: it.listingId, qty, reason: 'invalid_qty' });
        continue;
      }
      const row = await Inventory.findOneAndUpdate(
        {
          tenantId,
          tenantProductId: it.listingId,
          warehouseId: null,
          $expr: { $gte: ['$qtyOnHand', qty] },
        },
        [
          {
            $set: {
              qtyOnHand: { $subtract: ['$qtyOnHand', qty] },
              qtyReserved: { $max: [0, { $subtract: [{ $ifNull: ['$qtyReserved', 0] }, qty] }] },
              lastUpdatedAt: new Date(),
            },
          },
        ],
        { new: true }
      );
      if (row) {
        committed.push({ listingId: it.listingId, qty, row });
        const listing = await TenantProduct.findOne({ _id: it.listingId, tenantId });
        if (listing) {
          await this.refreshListingStock(listing, row);
          await this.publishStock(listing, row);
        }
      } else {
        failed.push({ listingId: it.listingId, qty, reason: 'insufficient_stock' });
      }
    }
    return { committed, failed };
  }

  /** COMPENSATION — restore qtyOnHand for items that were committed. */
  async restoreForOrder({ tenantId, items }) {
    for (const it of items) {
      const qty = Math.trunc(Number(it.qty) || 0);
      if (qty <= 0) continue;
      const row = await Inventory.findOneAndUpdate(
        { tenantId, tenantProductId: it.listingId, warehouseId: null },
        { $inc: { qtyOnHand: qty }, $set: { lastUpdatedAt: new Date() } },
        { new: true }
      );
      if (row) {
        const listing = await TenantProduct.findOne({ _id: it.listingId, tenantId });
        if (listing) {
          await this.refreshListingStock(listing, row);
          await this.publishStock(listing, row);
        }
      }
    }
    return { restored: items.length };
  }

  // ---------------- helpers ----------------

  /** Refresh the denormalized stockQty + availability on the tenant listing. */
  async refreshListingStock(listing, row) {
    const stock = availableOf(row);
    const availability = deriveAvailability(stock);
    const patch = {
      stockQty: stock,
      'availability.status': availability,
      'availability.updatedAt': new Date(),
      lastStockChangedAt: new Date(),
    };
    await TenantProduct.updateOne({ _id: listing._id }, { $set: patch });
    if (stock <= 0 && listing.status === TENANT_LISTING_STATUS.ACTIVE) {
      await TenantProduct.updateOne(
        { _id: listing._id },
        { $set: { status: TENANT_LISTING_STATUS.OUT_OF_STOCK, lastStatusChangedAt: new Date() } }
      );
    } else if (stock > 0 && listing.status === TENANT_LISTING_STATUS.OUT_OF_STOCK) {
      await TenantProduct.updateOne(
        { _id: listing._id },
        { $set: { status: TENANT_LISTING_STATUS.ACTIVE, lastStatusChangedAt: new Date() } }
      );
    }
  }

  /** Search index listens on tenant_product — never publish entityType=inventory. */
  async publishStock(listing, row) {
    await catalogEventService.publish({
      eventType: 'stock_changed',
      entityType: 'tenant_product',
      entityId: listing._id || listing.id,
      tenantId: listing.tenantId,
      payload: {
        listingId: listing._id || listing.id,
        qtyOnHand: row.qtyOnHand,
        qtyReserved: row.qtyReserved,
        qtyAvailable: availableOf(row),
      },
    }).catch(() => {});
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
