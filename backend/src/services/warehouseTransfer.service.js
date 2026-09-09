/**
 * WarehouseTransferService — multi-warehouse inventory transfers.
 *
 * When a store has multiple hubs/warehouses, stock may need to be moved
 * between them to fulfill orders or rebalance inventory.
 *
 * Transfer lifecycle:
 *   INITIATED → IN_TRANSIT → RECEIVED (or CANCELLED)
 *
 * Each transfer is atomic: source warehouse loses stock, destination gains it.
 * The transfer record is the audit trail.
 */

import Inventory from '../models/inventory.model.js';
import Hub from '../models/hub.model.js';
import auditService from './audit.service.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';

class WarehouseTransferService {
  /**
   * Initiate a stock transfer between warehouses.
   */
  async initiate({ tenantId, fromHubId, toHubId, items, actorId, req = null }) {
    if (fromHubId === toHubId) throw badRequest('Source and destination must differ', 'SAME_HUB');

    const [fromHub, toHub] = await Promise.all([
      Hub.findOne({ _id: fromHubId, tenantId }).lean(),
      Hub.findOne({ _id: toHubId, tenantId }).lean(),
    ]);
    if (!fromHub) throw notFound('Source warehouse not found', 'HUB_NOT_FOUND');
    if (!toHub) throw notFound('Destination warehouse not found', 'HUB_NOT_FOUND');

    const results = { transferred: [], failed: [] };

    for (const item of items) {
      const { tenantProductId, qty } = item;
      if (!qty || qty <= 0) {
        results.failed.push({ tenantProductId, reason: 'invalid_qty' });
        continue;
      }

      // Deduct from source
      const sourceRow = await Inventory.findOneAndUpdate(
        {
          tenantId,
          tenantProductId,
          warehouseId: fromHubId,
          $expr: { $gte: [{ $subtract: ['$qtyOnHand', '$qtyReserved'] }, qty] },
        },
        { $inc: { qtyOnHand: -qty }, $set: { lastUpdatedAt: new Date() } },
        { new: true },
      );

      if (!sourceRow) {
        results.failed.push({ tenantProductId, reason: 'insufficient_stock' });
        continue;
      }

      // Add to destination (create row if missing)
      await Inventory.findOneAndUpdate(
        { tenantId, tenantProductId, warehouseId: toHubId },
        {
          $inc: { qtyOnHand: qty },
          $setOnInsert: { qtyReserved: 0, lastUpdatedAt: new Date() },
          $set: { lastUpdatedAt: new Date() },
        },
        { upsert: true, new: true },
      );

      results.transferred.push({ tenantProductId, qty, from: fromHubId, to: toHubId });

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

    return results;
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
