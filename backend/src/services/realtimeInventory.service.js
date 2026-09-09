/**
 * RealtimeInventoryService — instant stock feedback via SSE.
 *
 * When inventory changes (sale, restock, adjustment), broadcast the
 * update to all connected clients watching that product.
 *
 * Uses the SSE broadcast infrastructure for push notifications.
 * No polling needed — the client receives updates within milliseconds.
 */

import { broadcast } from '../routes/sse.routes.js';
import Inventory from '../models/inventory.model.js';

class RealtimeInventoryService {
  /**
   * Broadcast an inventory change to connected clients.
   *
   * @param {Object} opts
   * @param {string} opts.tenantId
   * @param {string} opts.tenantProductId
   * @param {string} opts.event - 'reserved' | 'released' | 'adjusted' | 'restocked'
   * @param {Object} opts.stock - { qtyOnHand, qtyReserved, qtyAvailable }
   */
  async broadcastChange({ tenantId, tenantProductId, event, stock }) {
    broadcast('activity', 'inventory_change', {
      tenantProductId: String(tenantProductId),
      event,
      stock,
      timestamp: new Date().toISOString(),
    }, tenantId);
  }

  /**
   * Get real-time stock for a product (used by storefront).
   * Returns aggregated stock across all warehouses.
   */
  async getStock({ tenantId, tenantProductId }) {
    const rows = await Inventory.find({ tenantId, tenantProductId }).lean();
    const total = rows.reduce(
      (acc, r) => ({
        qtyOnHand: acc.qtyOnHand + (r.qtyOnHand || 0),
        qtyReserved: acc.qtyReserved + (r.qtyReserved || 0),
      }),
      { qtyOnHand: 0, qtyReserved: 0 },
    );
    return {
      ...total,
      qtyAvailable: Math.max(0, total.qtyOnHand - total.qtyReserved),
      inStock: total.qtyOnHand - total.qtyReserved > 0,
      lowStock: (total.qtyOnHand - total.qtyReserved) > 0 && (total.qtyOnHand - total.qtyReserved) <= 5,
    };
  }
}

export default new RealtimeInventoryService();
