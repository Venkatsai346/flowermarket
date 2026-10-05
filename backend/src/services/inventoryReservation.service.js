import mongoose from 'mongoose';
import Inventory from '../models/inventory.model.js';
import InventoryReservation from '../models/inventoryReservation.model.js';
import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import auditService from './audit.service.js';
import inventoryService from './inventory.service.js';
import config from '../config/index.js';
import { transactionsSupported } from '../utils/transactions.js';
import { conflict, internal } from '../utils/ApiError.js';
import { INVENTORY_RESERVATION_STATUS, ORDER_STATUS } from '../constants/enums.js';
import {
  inventoryReservationDuration,
  inventoryReservationOperations,
  inventoryReservationSweep,
} from '../observability/registry.js';

const ACTIVE = INVENTORY_RESERVATION_STATUS.ACTIVE;
const terminalOrderStatuses = ['cancelled', 'delivered', 'refunded'];
const transactionOptions = {
  readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary',
};

const transition = (from, to, reason, actorId = null) => ({
  from, to, reason, at: new Date(), actorId,
});

class InventoryReservationService {
  expiry(now = new Date()) {
    return new Date(now.getTime() + config.inventoryReservations.ttlMinutes * 60000);
  }

  async runAtomic(work, compensate = async () => {}) {
    const transactional = await transactionsSupported();
    if (!transactional && process.env.NODE_ENV === 'production') {
      throw internal('Inventory reservations require a transaction-capable MongoDB topology in production.', 'INVENTORY_RESERVATION_TRANSACTIONS_REQUIRED');
    }
    if (!transactional) {
      try { return await work(null); } catch (error) { await compensate().catch(() => {}); throw error; }
    }
    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => { result = await work(session); }, transactionOptions);
      return result;
    } finally {
      await session.endSession();
    }
  }

  async reserveOrder({ tenantId, orderId, userId, idempotencyKey, holdExpiresAt = null, actorId = null, req = null }) {
    const started = process.hrtime.bigint();
    const existing = await InventoryReservation.find({ tenantId, orderId }).lean();
    if (existing.length) {
      if (existing.every((row) => [ACTIVE, INVENTORY_RESERVATION_STATUS.CONFIRMED].includes(row.status))) {
        inventoryReservationOperations.inc({ operation: 'reserve', outcome: 'replay' });
        return { reservations: existing, replayed: true };
      }
      throw conflict('A partial reservation lifecycle requires reconciliation', 'INVENTORY_RESERVATION_INCOMPLETE');
    }
    const items = await OrderItem.find({ tenantId, orderId }).lean();
    if (!items.length) throw conflict('Order has no lines to reserve', 'INVENTORY_RESERVATION_EMPTY');
    const configuredExpiry = this.expiry();
    const holdExpiry = holdExpiresAt ? new Date(holdExpiresAt) : null;
    const expiresAt = holdExpiry && Number.isFinite(holdExpiry.getTime()) && holdExpiry < configuredExpiry
      ? holdExpiry : configuredExpiry;
    if (expiresAt <= new Date()) throw conflict('Reservation window has already expired', 'INVENTORY_RESERVATION_EXPIRED');
    const reserved = [];
    try {
      const reservations = await this.runAtomic(async (session) => {
        const output = [];
        for (const item of items) {
          const warehouseId = item.fulfillmentAllocation?.warehouseId || null;
          const qty = Number(item.qty);
          const policySafetyStock = Number(item.fulfillmentAllocation?.policySafetyStockAtPlan || 0);
          const options = { new: true, ...(session ? { session } : {}) };
          // Deliberately sequential: all-or-nothing basket reservation with deterministic compensation order.
          // eslint-disable-next-line no-await-in-loop
          const inventory = await Inventory.findOneAndUpdate({
            tenantId, tenantProductId: item.tenantProductId, warehouseId,
            isSellable: { $ne: false }, status: 'active',
            $expr: { $gte: [
              { $subtract: [
                '$qtyOnHand',
                { $add: ['$qtyReserved', { $ifNull: ['$safetyStock', 0] }, policySafetyStock] },
              ] },
              qty,
            ] },
          }, {
            $inc: { qtyReserved: qty, version: 1 }, $set: { lastUpdatedAt: new Date() },
          }, options);
          if (!inventory) throw conflict('Stock changed before payment could be reserved', 'INVENTORY_RESERVATION_UNAVAILABLE', {
            listingId: item.tenantProductId, warehouseId, qty,
          });
          reserved.push({ inventoryId: inventory._id, qty });
          const payload = {
            tenantId, orderId, userId, idempotencyKey,
            tenantProductId: item.tenantProductId, inventoryId: inventory._id, warehouseId,
            qty, policySafetyStock, status: ACTIVE, expiresAt,
            transitions: [transition(null, ACTIVE, 'checkout_payment_window', actorId)],
          };
          // Sequential with the inventory mutation; both share the transaction in production.
          // eslint-disable-next-line no-await-in-loop
          const docs = await InventoryReservation.create([payload], session ? { session } : undefined);
          output.push(docs[0]);
        }
        return output;
      }, async () => {
        for (const row of reserved.reverse()) {
          // Sequential compensation is required to unwind exactly the rows already incremented.
          // eslint-disable-next-line no-await-in-loop
          await Inventory.updateOne({ _id: row.inventoryId, qtyReserved: { $gte: row.qty } }, {
            $inc: { qtyReserved: -row.qty, version: 1 }, $set: { lastUpdatedAt: new Date() },
          });
        }
        await InventoryReservation.deleteMany({ tenantId, orderId, status: ACTIVE });
      });
      await this.refreshListings(reservations);
      await this.audit('inventory_reservation_created', { tenantId, orderId, actorId, req, reservations });
      inventoryReservationOperations.inc({ operation: 'reserve', outcome: 'success' });
      inventoryReservationDuration.observe({ operation: 'reserve' }, Number(process.hrtime.bigint() - started) / 1e9);
      return { reservations, replayed: false };
    } catch (error) {
      inventoryReservationOperations.inc({ operation: 'reserve', outcome: 'failed' });
      throw error;
    }
  }

  async confirmOrder({ tenantId, orderId, actorId = null, req = null }) {
    const started = process.hrtime.bigint();
    const rows = await InventoryReservation.find({ tenantId, orderId }).sort({ createdAt: 1 });
    if (!rows.length) throw conflict('Order has no inventory reservation', 'INVENTORY_RESERVATION_MISSING');
    if (rows.every((row) => row.status === INVENTORY_RESERVATION_STATUS.CONFIRMED)) {
      inventoryReservationOperations.inc({ operation: 'confirm', outcome: 'replay' });
      return { reservations: rows, replayed: true };
    }
    const confirmationNow = new Date();
    if (rows.some((row) => row.status !== ACTIVE || row.expiresAt <= confirmationNow)) {
      throw conflict('Inventory reservation expired before payment confirmation', 'INVENTORY_RESERVATION_EXPIRED');
    }
    const committed = [];
    const confirmedReservationIds = [];
    try {
      const reservations = await this.runAtomic(async (session) => {
        const output = [];
        for (const row of rows) {
          const options = { new: true, ...(session ? { session } : {}) };
          // Sequential because a basket confirmation must preserve compensation order on standalone Mongo.
          // eslint-disable-next-line no-await-in-loop
          const inventory = await Inventory.findOneAndUpdate({
            _id: row.inventoryId, tenantId, qtyReserved: { $gte: row.qty }, qtyOnHand: { $gte: row.qty },
          }, {
            $inc: { qtyOnHand: -row.qty, qtyReserved: -row.qty, version: 1 },
            $set: { lastUpdatedAt: new Date() },
          }, options);
          if (!inventory) throw conflict('Reserved inventory is inconsistent', 'INVENTORY_RESERVATION_DRIFT', { reservationId: row._id });
          committed.push({ inventoryId: row.inventoryId, qty: row.qty });
          // Sequential on purpose: settle the reservation only after its exact inventory row commits.
          // eslint-disable-next-line no-await-in-loop
          const reservation = await InventoryReservation.findOneAndUpdate({
            _id: row._id, status: ACTIVE, expiresAt: { $gt: confirmationNow },
          }, {
            $set: { status: INVENTORY_RESERVATION_STATUS.CONFIRMED, confirmedAt: new Date() },
            $inc: { version: 1 },
            $push: { transitions: transition(ACTIVE, INVENTORY_RESERVATION_STATUS.CONFIRMED, 'payment_captured', actorId) },
          }, options);
          if (!reservation) throw conflict('Reservation was concurrently settled', 'INVENTORY_RESERVATION_RACE');
          confirmedReservationIds.push(reservation._id);
          output.push(reservation);
        }
        return output;
      }, async () => {
        for (const row of committed.reverse()) {
          // Sequential compensation restores physical and reserved stock together.
          // eslint-disable-next-line no-await-in-loop
          await Inventory.updateOne({ _id: row.inventoryId }, {
            $inc: { qtyOnHand: row.qty, qtyReserved: row.qty, version: 1 }, $set: { lastUpdatedAt: new Date() },
          });
        }
        await InventoryReservation.updateMany(
          { _id: { $in: confirmedReservationIds }, status: INVENTORY_RESERVATION_STATUS.CONFIRMED },
          { $set: { status: ACTIVE, confirmedAt: null }, $inc: { version: 1 } },
        );
      });
      await this.refreshListings(reservations);
      await this.audit('inventory_reservation_confirmed', { tenantId, orderId, actorId, req, reservations });
      inventoryReservationOperations.inc({ operation: 'confirm', outcome: 'success' });
      inventoryReservationDuration.observe({ operation: 'confirm' }, Number(process.hrtime.bigint() - started) / 1e9);
      return { reservations, replayed: false };
    } catch (error) {
      inventoryReservationOperations.inc({ operation: 'confirm', outcome: 'failed' });
      throw error;
    }
  }

  async releaseOrder({ tenantId, orderId, reason = 'order_cancelled', actorId = null, req = null, terminalStatus = INVENTORY_RESERVATION_STATUS.RELEASED }) {
    const rows = await InventoryReservation.find({ tenantId, orderId, status: ACTIVE }).sort({ createdAt: 1 });
    if (!rows.length) return { released: 0, replayed: true };
    const releasedInventory = [];
    const settledReservationIds = [];
    const settled = await this.runAtomic(async (session) => {
      const output = [];
      for (const row of rows) {
        const options = { new: true, ...(session ? { session } : {}) };
        // Sequential to preserve deterministic standalone compensation.
        // eslint-disable-next-line no-await-in-loop
        const inventory = await Inventory.findOneAndUpdate({
          _id: row.inventoryId, tenantId, qtyReserved: { $gte: row.qty },
        }, {
          $inc: { qtyReserved: -row.qty, version: 1 }, $set: { lastUpdatedAt: new Date() },
        }, options);
        if (!inventory) throw conflict('Reserved quantity cannot be released safely', 'INVENTORY_RESERVATION_DRIFT', { reservationId: row._id });
        releasedInventory.push({ inventoryId: row.inventoryId, qty: row.qty });
        // Sequential on purpose: reservation state settles after its inventory decrement.
        // eslint-disable-next-line no-await-in-loop
        const reservation = await InventoryReservation.findOneAndUpdate({ _id: row._id, status: ACTIVE }, {
          $set: { status: terminalStatus, releasedAt: new Date(), releaseReason: reason },
          $inc: { version: 1 },
          $push: { transitions: transition(ACTIVE, terminalStatus, reason, actorId) },
        }, options);
        if (!reservation) throw conflict('Reservation was concurrently settled', 'INVENTORY_RESERVATION_RACE');
        settledReservationIds.push(reservation._id);
        output.push(reservation);
      }
      return output;
    }, async () => {
      for (const row of releasedInventory.reverse()) {
        // Sequential on purpose: reverse only mutations completed before a standalone failure.
        // eslint-disable-next-line no-await-in-loop
        await Inventory.updateOne({ _id: row.inventoryId }, {
          $inc: { qtyReserved: row.qty, version: 1 }, $set: { lastUpdatedAt: new Date() },
        });
      }
      await InventoryReservation.updateMany(
        { _id: { $in: settledReservationIds }, status: terminalStatus },
        { $set: { status: ACTIVE, releasedAt: null, releaseReason: null }, $inc: { version: 1 } },
      );
    });
    await this.refreshListings(settled);
    await this.audit('inventory_reservation_released', { tenantId, orderId, actorId, req, reservations: settled, reason });
    inventoryReservationOperations.inc({ operation: terminalStatus === INVENTORY_RESERVATION_STATUS.EXPIRED ? 'expire' : 'release', outcome: 'success' });
    return { released: settled.length, replayed: false, reservations: settled };
  }

  async list({ tenantId, status = null, limit = 100 }) {
    const query = { tenantId, ...(status ? { status } : {}) };
    const rows = await InventoryReservation.find(query).sort({ createdAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 500)).lean();
    const counts = await InventoryReservation.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)) } },
      { $group: { _id: '$status', count: { $sum: 1 }, quantity: { $sum: '$qty' } } },
    ]);
    return { items: rows, summary: Object.fromEntries(counts.map((row) => [row._id, { count: row.count, quantity: row.quantity }])) };
  }

  async sweepExpired({ tenantId = null, limit = config.inventoryReservations.sweepBatchSize }) {
    const now = new Date();
    const query = { status: ACTIVE, expiresAt: { $lte: now }, ...(tenantId ? { tenantId } : {}) };
    const groups = await InventoryReservation.aggregate([
      { $match: query }, { $sort: { expiresAt: 1 } },
      { $group: { _id: { tenantId: '$tenantId', orderId: '$orderId' }, expiresAt: { $min: '$expiresAt' } } },
      { $sort: { expiresAt: 1 } }, { $limit: Math.min(Number(limit) || 100, 1000) },
    ]);
    let expired = 0; let failed = 0;
    for (const group of groups) {
      try {
        // Sequential groups bound write pressure and make each order an isolated atomic unit.
        // eslint-disable-next-line no-await-in-loop
        const result = await this.releaseOrder({
          tenantId: group._id.tenantId, orderId: group._id.orderId,
          reason: 'payment_window_expired', terminalStatus: INVENTORY_RESERVATION_STATUS.EXPIRED,
        });
        expired += result.released;
        if (result.released > 0) {
          // Sequential on purpose: mark this order only after all of its expired lines are released.
          // eslint-disable-next-line no-await-in-loop
          await Order.updateOne({ _id: group._id.orderId, status: { $in: [ORDER_STATUS.CREATED, ORDER_STATUS.PAYMENT_PENDING] } }, {
            $set: { 'fulfillmentPlan.status': 'failed', 'fulfillmentPlan.reservationStatus': 'expired' },
          });
        }
      } catch { failed += 1; }
    }
    inventoryReservationSweep.inc({ outcome: 'expired' }, expired);
    inventoryReservationSweep.inc({ outcome: 'failed' }, failed);
    return { scannedOrders: groups.length, expired, failed };
  }

  async reconcile({ tenantId = null, limit = config.inventoryReservations.reconcileBatchSize, repair = false }) {
    const match = { ...(tenantId ? { tenantId } : {}), status: { $in: [ACTIVE, INVENTORY_RESERVATION_STATUS.ALLOCATING] } };
    const rows = await InventoryReservation.find(match).sort({ updatedAt: 1 }).limit(Math.min(Number(limit) || 200, 2000)).lean();
    const orderIds = [...new Set(rows.map((row) => String(row.orderId)))];
    const orders = await Order.find({ _id: { $in: orderIds } }).select('status').lean();
    const orderById = new Map(orders.map((order) => [String(order._id), order]));
    const issues = [];
    for (const row of rows) {
      const order = orderById.get(String(row.orderId));
      const inventory = await Inventory.findById(row.inventoryId).lean(); // eslint-disable-line no-await-in-loop
      let code = null;
      if (!order) code = 'order_missing';
      else if (terminalOrderStatuses.includes(order.status)) code = 'active_on_terminal_order';
      else if (!inventory) code = 'inventory_missing';
      else if (Number(inventory.qtyReserved || 0) < row.qty) code = 'reserved_quantity_drift';
      else if (row.status === INVENTORY_RESERVATION_STATUS.ALLOCATING) code = 'allocation_incomplete';
      if (!code) continue;
      issues.push({ reservationId: row._id, orderId: row.orderId, code });
      if (repair && code === 'active_on_terminal_order') {
        // Idempotent group release; subsequent rows become no-ops.
        // eslint-disable-next-line no-await-in-loop
        await this.releaseOrder({ tenantId: row.tenantId, orderId: row.orderId, reason: 'reconciliation_terminal_order' }).catch(() => {});
      }
    }
    inventoryReservationSweep.inc({ outcome: 'reconciliation_issue' }, issues.length);
    return { scanned: rows.length, issues, repaired: repair ? issues.filter((item) => item.code === 'active_on_terminal_order').length : 0 };
  }

  async refreshListings(reservations) {
    const listingIds = [...new Set((reservations || []).map((row) => String(row.tenantProductId)))];
    const listings = await TenantProduct.find({ _id: { $in: listingIds } });
    await Promise.all(listings.map((listing) => inventoryService.refreshListingStock(listing)));
  }

  async audit(action, { tenantId, orderId, actorId, req, reservations, reason = null }) {
    await auditService.record({
      action: 'stock_change', entityType: 'order', entityId: orderId,
      tenantId, actorId, actorType: actorId ? 'customer' : 'system', req,
      meta: { action, reason, reservationIds: reservations.map((row) => row._id), quantity: reservations.reduce((sum, row) => sum + row.qty, 0) },
    }).catch(() => {});
  }
}

export default new InventoryReservationService();
