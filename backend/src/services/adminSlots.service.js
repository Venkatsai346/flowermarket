/**
 * AdminSlotsService — hub management + intraday slot override (Phase 4).
 *
 * The blueprint rule: "forecasting sets the number; the atomic lock enforces
 * it." The manualCapacity override is the HUMAN override on top — honored by
 * the atomic reserve gate ($ifNull) so overselling stays impossible.
 */

import Hub from '../models/hub.model.js';
import ServiceablePincode from '../models/serviceablePincode.model.js';
import DeliverySlot from '../models/deliverySlot.model.js';
import slotService from './slot.service.js';
import auditService from './audit.service.js';
import { serializeList } from '../utils/serialize.js';
import { notFound, badRequest, conflict } from '../utils/ApiError.js';

export class AdminSlotsService {
  // ---------------- hubs ----------------
  async listHubs({ tenantId }) {
    const hubs = await Hub.find({ tenantId, isDeleted: { $ne: true } }).sort({ createdAt: 1 }).lean();
    return serializeList(hubs);
  }

  async createHub({ tenantId, payload, actorId = null, req = null }) {
    const existing = await Hub.findOne({ tenantId, code: payload.code });
    if (existing) throw conflict('Hub code already exists for this tenant', 'DUPLICATE_HUB_CODE');
    const hub = await Hub.create({
      tenantId,
      name: payload.name,
      code: payload.code,
      zoneId: payload.zoneId || null,
      address: payload.address || {},
      coordinates: payload.coordinates || null,
      areaId: payload.areaId || null,
      serviceablePincodes: payload.pincodes || [],
      defaultSlotCapacity: payload.defaultSlotCapacity || 25,
      isActive: payload.isActive !== false,
      status: 'active',
    });
    // link ServiceablePincode rows so resolveHub works immediately
    await this.syncPincodes({ tenantId, hubId: hub._id, add: hub.serviceablePincodes, actorId, req, silent: true });
    return hub;
  }

  async updateHub({ tenantId, hubId, payload, actorId = null, req = null }) {
    const hub = await Hub.findOne({ _id: hubId, tenantId });
    if (!hub) throw notFound('Hub not found', 'HUB_NOT_FOUND');
    const allowed = ['name', 'address', 'coordinates', 'defaultSlotCapacity', 'zoneId'];
    for (const k of allowed) if (k in payload) hub[k] = payload[k];
    await hub.save();
    await auditService.record({
      action: 'update', entityType: 'hub', entityId: hub._id,
      tenantId, actorId, actorType: 'admin', after: { name: hub.name }, req,
    });
    return hub;
  }

  async toggleHub({ tenantId, hubId, isActive, actorId = null, req = null }) {
    const hub = await Hub.findOne({ _id: hubId, tenantId });
    if (!hub) throw notFound('Hub not found', 'HUB_NOT_FOUND');
    hub.isActive = isActive;
    await hub.save();
    await auditService.record({
      action: isActive ? 'activate' : 'deactivate', entityType: 'hub', entityId: hub._id,
      tenantId, actorId, actorType: 'admin', after: { isActive }, req,
    });
    return hub;
  }

  async managePincodes({ tenantId, hubId, add = [], remove = [], actorId = null, req = null }) {
    const hub = await Hub.findOne({ _id: hubId, tenantId });
    if (!hub) throw notFound('Hub not found', 'HUB_NOT_FOUND');
    await this.syncPincodes({ tenantId, hubId, add, remove, actorId, req });
    // refresh the curated array
    const current = await ServiceablePincode.find({ tenantId, hubId, isServiceable: true }).lean();
    hub.serviceablePincodes = current.map((p) => p.pincode);
    await hub.save();
    return { hub, serviceablePincodes: hub.serviceablePincodes };
  }

  /** Keep ServiceablePincode rows consistent with the hub's curated list. */
  async syncPincodes({ tenantId, hubId, add = [], remove = [], actorId = null, req = null, silent = false }) {
    for (const pin of add) {
      const pinStr = String(pin).trim();
      if (!/^\d{6}$/.test(pinStr)) continue;
      await ServiceablePincode.updateOne(
        { tenantId, pincode: pinStr },
        { $set: { hubId, isServiceable: true } },
        { upsert: true }
      );
    }
    for (const pin of remove) {
      await ServiceablePincode.updateOne(
        { tenantId, pincode: String(pin).trim() },
        { $set: { isServiceable: false } }
      );
    }
    if (!silent) {
      await auditService.record({
        action: 'pincodes', entityType: 'hub', entityId: hubId,
        tenantId, actorId, actorType: 'admin',
        after: { add, remove }, req,
      });
    }
  }

  // ---------------- slots ----------------
  async listSlots({ tenantId, hubId = null, fromDate, toDate }) {
    const q = { tenantId, date: { $gte: fromDate, $lte: toDate }, isDeleted: { $ne: true } };
    if (hubId) q.hubId = hubId;
    const slots = await DeliverySlot.find(q).sort({ date: 1, startTime: 1 }).lean();
    return serializeList(slots.map((s) => ({
      ...s,
      effectiveCapacity: s.manualCapacity ?? s.totalCapacity,
      remaining: Math.max(0, (s.manualCapacity ?? s.totalCapacity) - s.reservedCapacity),
    })));
  }

  /** Intraday capacity override — effective immediately for the atomic gate. */
  async overrideSlot({ tenantId, slotId, manualCapacity, reason, actorId = null, req = null }) {
    manualCapacity = Math.trunc(Number(manualCapacity));
    if (!Number.isFinite(manualCapacity) || manualCapacity < 1) {
      throw badRequest('manualCapacity must be >= 1', 'INVALID_CAPACITY');
    }
    const slot = await DeliverySlot.findOne({ _id: slotId, tenantId });
    if (!slot) throw notFound('Slot not found', 'SLOT_NOT_FOUND');
    if (slot.reservedCapacity > manualCapacity) {
      throw conflict(`Cannot shrink capacity below ${slot.reservedCapacity} already-reserved units`, 'CAPACITY_BELOW_RESERVED');
    }
    const before = slot.manualCapacity ?? slot.totalCapacity;
    slot.manualCapacity = manualCapacity;
    slot.manualCapacityAt = new Date();
    slot.manualCapacityBy = actorId || null;
    slot.manualCapacityReason = reason || null;
    await slot.save();
    await auditService.record({
      action: 'override', entityType: 'delivery_slot', entityId: slot._id,
      tenantId, actorId, actorType: 'admin',
      before: { capacity: before }, after: { capacity: manualCapacity },
      meta: { reason }, req,
    });
    return slot;
  }

  async setSlotStatus({ tenantId, slotId, status, reason = null, actorId = null, req = null }) {
    if (!['open', 'closed'].includes(status)) throw badRequest('Status must be open or closed', 'INVALID_SLOT_STATUS');
    const slot = await DeliverySlot.findOne({ _id: slotId, tenantId });
    if (!slot) throw notFound('Slot not found', 'SLOT_NOT_FOUND');
    const before = slot.status;
    slot.status = status;
    await slot.save();
    await auditService.record({
      action: status === 'open' ? 'reopen' : 'close', entityType: 'delivery_slot', entityId: slot._id,
      tenantId, actorId, actorType: 'admin', before: { status: before }, after: { status }, meta: { reason }, req,
    });
    return slot;
  }

  /** Daily utilization grid (effective capacity honored). */
  async utilization({ tenantId, hubId, fromDate, toDate }) {
    const out = [];
    const d = new Date(`${fromDate}T00:00:00Z`);
    const end = new Date(`${toDate}T00:00:00Z`);
    while (d <= end) {
      const date = d.toISOString().slice(0, 10);
      const slots = await slotService.utilization({ tenantId, hubId, date });
      const reserved = slots.reduce((a, s) => a + s.reserved, 0);
      const capacity = slots.reduce((a, s) => a + s.total, 0);
      out.push({
        date,
        slots: slots.length,
        capacity,
        reserved,
        fillRate: capacity ? Math.round((reserved / capacity) * 100) / 100 : 0,
      });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }
}

export default new AdminSlotsService();
