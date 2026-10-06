/**
 * WarehouseTransferService — multi-warehouse inventory transfers.
 *
 * When a store has multiple hubs/warehouses, stock may need to be moved
 * between them to fulfill orders or rebalance inventory.
 *
 * Transfer lifecycle:
 *   PROCESSING → COMPLETED | PARTIAL | FAILED
 *
 * Each line uses an atomic source guard and compensates a destination failure.
 * The idempotent transfer record is the durable operator audit trail.
 */

import { createHash, randomUUID } from 'node:crypto';
import Inventory from '../models/inventory.model.js';
import InventoryTransfer from '../models/inventoryTransfer.model.js';
import Hub from '../models/hub.model.js';
import auditService from './audit.service.js';
import inventoryService from './inventory.service.js';
import TenantProduct from '../models/tenantProduct.model.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';

class WarehouseTransferService {
  /**
   * Initiate a stock transfer between warehouses.
   */
  async initiate({ tenantId, fromHubId, toHubId, items, actorId, idempotencyKey = null, req = null }) {
    if (String(fromHubId) === String(toHubId)) throw badRequest('Source and destination must differ', 'SAME_HUB');

    const [fromHub, toHub] = await Promise.all([
      Hub.findOne({ _id: fromHubId, tenantId }).lean(),
      Hub.findOne({ _id: toHubId, tenantId }).lean(),
    ]);
    if (!fromHub) throw notFound('Source warehouse not found', 'HUB_NOT_FOUND');
    if (!toHub) throw notFound('Destination warehouse not found', 'HUB_NOT_FOUND');

    const requestKey = String(idempotencyKey || randomUUID()).trim();
    if (requestKey.length < 8 || requestKey.length > 128) {
      throw badRequest('Idempotency key must contain 8 to 128 characters', 'INVALID_IDEMPOTENCY_KEY');
    }
    const normalizedItems = items.map(({ tenantProductId, qty }) => ({
      tenantProductId: String(tenantProductId), qty: Number(qty),
    }));
    const requestFingerprint = createHash('sha256').update(JSON.stringify({
      fromHubId: String(fromHubId), toHubId: String(toHubId), items: normalizedItems,
    })).digest('hex');
    let transfer;
    try {
      transfer = await InventoryTransfer.create({
        tenantId, requestKey, requestFingerprint, fromHubId, toHubId,
        items: normalizedItems, actorId,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      transfer = await InventoryTransfer.findOne({ tenantId, requestKey });
      if (!transfer || transfer.requestFingerprint !== requestFingerprint) {
        throw conflict('Idempotency key was already used for a different transfer', 'IDEMPOTENCY_KEY_REUSED');
      }
      return {
        transfer: transfer.toJSON(), idempotentReplay: true,
        transferred: transfer.items.filter((item) => item.status === 'completed'),
        failed: transfer.items.filter((item) => item.status === 'failed'),
      };
    }

    const results = { transfer: null, idempotentReplay: false, transferred: [], failed: [] };

    for (const [itemIndex, item] of items.entries()) {
      const { tenantProductId, qty } = item;
      if (!qty || qty <= 0) {
        results.failed.push({ tenantProductId, reason: 'invalid_qty' });
        transfer.items[itemIndex].status = 'failed';
        transfer.items[itemIndex].failureReason = 'invalid_qty';
        // sequential on purpose: persist each line outcome before processing the next stock movement
        // eslint-disable-next-line no-await-in-loop
        await transfer.save();
        continue;
      }

      // Deduct from source
      // sequential on purpose: each item must finish its source-to-destination transfer before the next starts
      // eslint-disable-next-line no-await-in-loop
      const sourceRow = await Inventory.findOneAndUpdate(
        {
          tenantId,
          tenantProductId,
          warehouseId: fromHubId,
          $expr: { $gte: [{ $subtract: ['$qtyOnHand', '$qtyReserved'] }, qty] },
        },
        { $inc: { qtyOnHand: -qty, version: 1 }, $set: { lastUpdatedAt: new Date() } },
        { new: true },
      );

      if (!sourceRow) {
        results.failed.push({ tenantProductId, reason: 'insufficient_stock' });
        transfer.items[itemIndex].status = 'failed';
        transfer.items[itemIndex].failureReason = 'insufficient_stock';
        // sequential on purpose: persist each line outcome before processing the next stock movement
        // eslint-disable-next-line no-await-in-loop
        await transfer.save();
        continue;
      }

      // Add to destination. If this second write fails on a standalone Mongo,
      // immediately compensate the source; replica-set deployments can later
      // wrap this same command in a transaction without changing semantics.
      try {
        // sequential on purpose: each item must finish its source-to-destination transfer before the next starts
        // eslint-disable-next-line no-await-in-loop
        await Inventory.findOneAndUpdate(
          { tenantId, tenantProductId, warehouseId: toHubId },
          {
            $inc: { qtyOnHand: qty, version: 1 },
            $setOnInsert: { qtyReserved: 0, safetyStock: 0, isSellable: true },
            $set: { lastUpdatedAt: new Date() },
          },
          { upsert: true, new: true },
        );
      } catch (error) {
        // sequential on purpose: compensation must restore the deducted source before failure is reported
        // eslint-disable-next-line no-await-in-loop
        await Inventory.updateOne(
          { _id: sourceRow._id },
          { $inc: { qtyOnHand: qty, version: 1 }, $set: { lastUpdatedAt: new Date() } },
        );
        results.failed.push({ tenantProductId, reason: 'destination_write_failed' });
        transfer.items[itemIndex].status = 'failed';
        transfer.items[itemIndex].failureReason = 'destination_write_failed';
        // sequential on purpose: persist compensated failure before processing another line
        // eslint-disable-next-line no-await-in-loop
        await transfer.save();
        continue;
      }

      results.transferred.push({ tenantProductId, qty, from: fromHubId, to: toHubId });
      transfer.items[itemIndex].status = 'completed';
      transfer.items[itemIndex].completedAt = new Date();
      // sequential on purpose: checkpoint the completed stock movement before ancillary refresh and audit work
      // eslint-disable-next-line no-await-in-loop
      await transfer.save();
      // sequential on purpose: refresh the listing snapshot only after both transfer sides are durable
      // eslint-disable-next-line no-await-in-loop
      const listing = await TenantProduct.findOne({ _id: tenantProductId, tenantId });
      if (listing) {
        // sequential on purpose: this listing snapshot must reflect its just-completed transfer
        // eslint-disable-next-line no-await-in-loop
        await inventoryService.refreshListingStock(listing);
      }

      // sequential on purpose: each item must finish its source-to-destination transfer before the next starts
      // eslint-disable-next-line no-await-in-loop
      await auditService.record({
        action: 'stock_transfer',
        entityType: 'inventory',
        entityId: tenantProductId,
        tenantId,
        actorId,
        actorType: 'tenant',
        meta: { fromHubId, toHubId, qty },
        req,
      });
    }

    transfer.transferredCount = results.transferred.length;
    transfer.failedCount = results.failed.length;
    transfer.status = results.transferred.length && results.failed.length
      ? 'partial'
      : results.transferred.length ? 'completed' : 'failed';
    transfer.completedAt = new Date();
    await transfer.save();
    results.transfer = transfer.toJSON();
    return results;
  }

  async list({ tenantId, limit = 50 }) {
    const rows = await InventoryTransfer.find({ tenantId })
      .sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 50, 1), 200)).lean();
    return serializeList(rows);
  }

  async get({ tenantId, transferId }) {
    const row = await InventoryTransfer.findOne({ _id: transferId, tenantId }).lean();
    if (!row) throw notFound('Warehouse transfer not found', 'TRANSFER_NOT_FOUND');
    return serializeList([row])[0];
  }

  /**
   * Get stock levels across all warehouses for a product.
   */
  async stockByWarehouse({ tenantId, tenantProductId }) {
    const rows = await Inventory.find({ tenantId, tenantProductId }).lean();
    const hubs = await Hub.find({ tenantId }).select('name code').lean();
    const hubMap = new Map(hubs.map((h) => [String(h._id), h]));

    return rows.map((r) => ({
      warehouseId: String(r.warehouseId || 'default'),
      warehouseName: r.warehouseId ? hubMap.get(String(r.warehouseId))?.name || 'Unknown' : 'Default',
      warehouseCode: r.warehouseId ? hubMap.get(String(r.warehouseId))?.code || '—' : 'DEFAULT',
      qtyOnHand: r.qtyOnHand || 0,
      qtyReserved: r.qtyReserved || 0,
      qtyAvailable: Math.max(0, (r.qtyOnHand || 0) - (r.qtyReserved || 0)),
    }));
  }

  /**
   * Get aggregate stock across all warehouses.
   */
  async aggregateStock({ tenantId, tenantProductId }) {
    const rows = await Inventory.find({ tenantId, tenantProductId }).lean();
    const total = rows.reduce(
      (acc, r) => ({
        qtyOnHand: acc.qtyOnHand + (r.qtyOnHand || 0),
        qtyReserved: acc.qtyReserved + (r.qtyReserved || 0),
      }),
      { qtyOnHand: 0, qtyReserved: 0 },
    );
    return { ...total, qtyAvailable: Math.max(0, total.qtyOnHand - total.qtyReserved) };
  }
}

export default new WarehouseTransferService();
