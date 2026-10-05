import mongoose from 'mongoose';
import WarehouseAllocationPolicy from '../models/warehouseAllocationPolicy.model.js';
import ServiceablePincode from '../models/serviceablePincode.model.js';
import Inventory from '../models/inventory.model.js';
import Hub from '../models/hub.model.js';
import { badRequest, conflict, notFound } from '../utils/ApiError.js';
import {
  FULFILLMENT_SPLIT_POLICY,
  WAREHOUSE_ALLOCATION_STRATEGY,
} from '../constants/enums.js';
import { warehouseAllocationNodes, warehouseAllocationRequests } from '../observability/registry.js';

const { Types } = mongoose;
const DEFAULT_POLICY = Object.freeze({
  strategy: WAREHOUSE_ALLOCATION_STRATEGY.NEAREST_AVAILABLE,
  splitPolicy: FULFILLMENT_SPLIT_POLICY.NEVER,
  reserveSafetyStock: 0,
  allowLegacyDefaultStock: true,
  requirePincodeForPromise: true,
  maxCandidateHubs: 12,
  defaultHandlingMinutes: 30,
  version: 1,
});

function coordinates(value) {
  const raw = value?.coordinates || value;
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const lng = Number(raw[0]); const lat = Number(raw[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

function distanceKm(a, b) {
  const from = coordinates(a); const to = coordinates(b);
  if (!from || !to) return null;
  const rad = (degree) => degree * Math.PI / 180;
  const dLat = rad(to[1] - from[1]); const dLng = rad(to[0] - from[0]);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(from[1])) * Math.cos(rad(to[1])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function combinations(values, size, start = 0, prefix = [], output = []) {
  if (prefix.length === size) { output.push(prefix); return output; }
  for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
    combinations(values, size, index + 1, [...prefix, values[index]], output);
  }
  return output;
}

function available(row, policy) {
  if (!row || row.isSellable === false || row.status !== 'active') return 0;
  return Math.max(0,
    Number(row.qtyOnHand || 0) - Number(row.qtyReserved || 0)
    - Number(row.safetyStock || 0) - Number(policy.reserveSafetyStock || 0));
}

function promiseFor({ hub, serviceability, policy, now = new Date() }) {
  const handling = Number(hub?.handlingTimeMinutes ?? policy.defaultHandlingMinutes ?? 30);
  const minMinutes = Math.max(handling, Number(serviceability?.minDeliveryTimeMinutes || 90));
  const maxMinutes = Math.max(minMinutes, handling + Number(serviceability?.maxDeliveryTimeMinutes || 1440));
  return {
    minAt: new Date(now.getTime() + minMinutes * 60000),
    maxAt: new Date(now.getTime() + maxMinutes * 60000),
    handlingMinutes: handling,
  };
}

class WarehouseAllocationService {
  async getPolicy(tenantId) {
    const row = await WarehouseAllocationPolicy.findOne({ tenantId, isDeleted: { $ne: true } }).lean();
    return row ? { ...DEFAULT_POLICY, ...row } : { ...DEFAULT_POLICY, tenantId, id: null };
  }

  async savePolicy({ tenantId, payload, expectedVersion = null, actorId = null }) {
    const current = await WarehouseAllocationPolicy.findOne({ tenantId, isDeleted: { $ne: true } });
    if (!current) {
      try {
        return await WarehouseAllocationPolicy.create({ ...payload, tenantId, updatedBy: actorId, version: 1 });
      } catch (error) {
        if (error?.code === 11000) throw conflict('Allocation policy changed concurrently', 'VERSION_CONFLICT');
        throw error;
      }
    }
    if (expectedVersion != null && Number(expectedVersion) !== current.version) {
      throw conflict('Allocation policy changed since it was opened', 'VERSION_CONFLICT');
    }
    Object.assign(current, payload, { updatedBy: actorId, version: current.version + 1 });
    return current.save();
  }

  async eligibleHubs({ tenantId, pincode = null, customerCoordinates = null, preferredHubId = null }) {
    const policy = await this.getPolicy(tenantId);
    const pin = pincode ? String(pincode).replace(/\D/g, '') : null;
    if (policy.requirePincodeForPromise && !pin && !preferredHubId) {
      return { policy, serviceability: null, hubs: [], reason: 'pincode_required' };
    }
    const serviceability = pin
      ? await ServiceablePincode.findOne({
        tenantId, pincode: pin, isServiceable: true, blocked: { $ne: true }, status: 'active',
      }).lean()
      : null;
    if (pin && !serviceability) return { policy, serviceability: null, hubs: [], reason: 'pincode_unserviceable' };

    const hubFilter = {
      tenantId, isActive: true, isFulfillmentEnabled: { $ne: false }, status: 'active',
    };
    const hubs = await Hub.find(hubFilter).lean();
    const primaryId = preferredHubId || serviceability?.hubId || null;
    const eligible = hubs.filter((hub) => {
      const primary = primaryId && String(hub._id) === String(primaryId);
      const explicitlyServes = pin && (hub.serviceablePincodes || []).includes(pin);
      if (!pin) return !preferredHubId || primary;
      if (!primary && !explicitlyServes && !hub.acceptsOverflow) return false;
      const km = distanceKm(customerCoordinates, hub.coordinates);
      if (!primary && hub.maxDeliveryRadiusKm != null && km != null && km > hub.maxDeliveryRadiusKm) return false;
      return true;
    }).map((hub) => ({
      ...hub,
      isPrimary: Boolean(primaryId && String(hub._id) === String(primaryId)),
      distanceKm: distanceKm(customerCoordinates, hub.coordinates),
    }));

    const strategy = policy.strategy;
    eligible.sort((a, b) => {
      if (strategy === WAREHOUSE_ALLOCATION_STRATEGY.SERVICE_HUB && a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      if (strategy === WAREHOUSE_ALLOCATION_STRATEGY.PRIORITY_THEN_DISTANCE) {
        const priority = Number(a.fulfillmentPriority || 100) - Number(b.fulfillmentPriority || 100);
        if (priority) return priority;
      }
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      const distance = (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER);
      if (distance) return distance;
      const priority = Number(a.fulfillmentPriority || 100) - Number(b.fulfillmentPriority || 100);
      return priority || String(a._id).localeCompare(String(b._id));
    });
    const limited = strategy === WAREHOUSE_ALLOCATION_STRATEGY.SERVICE_HUB
      && policy.splitPolicy !== FULFILLMENT_SPLIT_POLICY.ALLOW
      ? eligible.filter((hub) => hub.isPrimary).slice(0, 1)
      : eligible.slice(0, policy.maxCandidateHubs);
    return { policy, serviceability, hubs: limited, reason: limited.length ? null : 'no_eligible_hub' };
  }

  async availability({ tenantId, listingIds, pincode = null, customerCoordinates = null, preferredHubId = null }) {
    const ids = [...new Set((listingIds || []).map(String).filter(Types.ObjectId.isValid))];
    const context = await this.eligibleHubs({ tenantId, pincode, customerCoordinates, preferredHubId });
    const hubIds = context.hubs.map((hub) => hub._id);
    const warehouseFilter = [
      ...hubIds,
      ...(context.policy.allowLegacyDefaultStock ? [null] : []),
    ];
    const rows = ids.length && warehouseFilter.length
      ? await Inventory.find({
        tenantId, tenantProductId: { $in: ids }, warehouseId: { $in: warehouseFilter },
        isDeleted: { $ne: true }, isSellable: { $ne: false }, status: 'active',
      }).lean()
      : [];
    const hubById = new Map(context.hubs.map((hub) => [String(hub._id), hub]));
    const byListing = {};
    for (const id of ids) byListing[id] = { networkAvailableQty: 0, nodes: [], best: null };
    for (const row of rows) {
      const key = String(row.tenantProductId);
      const hub = row.warehouseId ? hubById.get(String(row.warehouseId)) : context.hubs[0];
      if (!hub) continue;
      // Legacy default stock is considered only when the listing has no real
      // row at the selected hub; never double count both pools.
      const node = {
        warehouseId: row.warehouseId ? String(row.warehouseId) : null,
        fulfillmentHubId: String(hub._id),
        warehouseCode: hub.code,
        warehouseName: hub.name,
        qtyOnHand: row.qtyOnHand || 0,
        qtyReserved: row.qtyReserved || 0,
          safetyStock: Number(row.safetyStock || 0),
        policySafetyStock: Number(context.policy.reserveSafetyStock || 0),
        allocatableQty: available(row, context.policy),
        distanceKm: hub.distanceKm == null ? null : Number(hub.distanceKm.toFixed(2)),
        legacyDefault: !row.warehouseId,
      };
      byListing[key].nodes.push(node);
    }
    for (const item of Object.values(byListing)) {
      const realHubIds = new Set(item.nodes.filter((node) => !node.legacyDefault).map((node) => node.fulfillmentHubId));
      item.nodes = item.nodes.filter((node) => !node.legacyDefault || !realHubIds.has(node.fulfillmentHubId));
      item.networkAvailableQty = item.nodes.reduce((sum, node) => sum + node.allocatableQty, 0);
      item.best = item.nodes.find((node) => node.allocatableQty > 0) || null;
    }
    return { ...context, byListing };
  }

  async plan({ tenantId, items, pincode, customerCoordinates = null, preferredHubId = null, now = new Date() }) {
    const normalized = (items || []).map((item) => ({
      listingId: String(item.listingId || item.tenantProductId || ''), qty: Math.trunc(Number(item.qty || 0)),
    })).filter((item) => Types.ObjectId.isValid(item.listingId) && item.qty > 0);
    if (!normalized.length) throw badRequest('No valid items to allocate', 'ALLOCATION_ITEMS_REQUIRED');
    const availability = await this.availability({
      tenantId, listingIds: normalized.map((item) => item.listingId), pincode,
      customerCoordinates, preferredHubId,
    });
    warehouseAllocationNodes.observe({ strategy: availability.policy.strategy }, availability.hubs.length);
    if (!availability.hubs.length) {
      warehouseAllocationRequests.inc({ strategy: availability.policy.strategy, outcome: 'no_node' });
      throw conflict('No fulfillment node can serve this delivery address', 'NO_FULFILLMENT_NODE', { reason: availability.reason });
    }

    // First prefer one ranked node. When split fulfillment is explicitly
    // enabled, solve a bounded minimum set-cover problem across candidate hubs:
    // minimum shipment count first, then ranked hub/distance cost.
    let selectedHubs = [];
    let selectedNodes = null;
    for (const hub of availability.hubs) {
      const nodes = normalized.map((item) => (availability.byListing[item.listingId]?.nodes || [])
        .find((node) => node.fulfillmentHubId === String(hub._id) && node.allocatableQty >= item.qty) || null);
      if (nodes.every(Boolean)) { selectedHubs = [hub]; selectedNodes = nodes; break; }
    }

    if (!selectedNodes && availability.policy.splitPolicy === FULFILLMENT_SPLIT_POLICY.ALLOW) {
      const requiredPrimary = preferredHubId ? String(preferredHubId) : null;
      let best = null;
      for (let size = 2; size <= availability.hubs.length && !best; size += 1) {
        for (const hubs of combinations(availability.hubs, size)) {
          if (requiredPrimary && !hubs.some((hub) => String(hub._id) === requiredPrimary)) continue;
          const hubIds = new Set(hubs.map((hub) => String(hub._id)));
          const nodes = normalized.map((item) => (availability.byListing[item.listingId]?.nodes || [])
            .find((node) => hubIds.has(node.fulfillmentHubId) && node.allocatableQty >= item.qty) || null);
          if (!nodes.every(Boolean)) continue;
          const used = new Set(nodes.map((node) => node.fulfillmentHubId));
          if (used.size !== hubs.length) continue;
          const score = nodes.reduce((sum, node) => {
            const rank = availability.hubs.findIndex((hub) => String(hub._id) === node.fulfillmentHubId);
            return sum + Math.max(rank, 0) * 10000 + Number(node.distanceKm || 0);
          }, 0);
          if (!best || score < best.score) best = { hubs, nodes, score };
        }
      }
      if (best) { selectedHubs = best.hubs; selectedNodes = best.nodes; }
    }

    if (!selectedNodes) {
      warehouseAllocationRequests.inc({ strategy: availability.policy.strategy, outcome: 'basket_shortage' });
      const shortages = normalized.map((item) => ({
        listingId: item.listingId, requested: item.qty,
        networkAvailable: availability.byListing[item.listingId]?.networkAvailableQty || 0,
        bestNodeAvailable: availability.byListing[item.listingId]?.best?.allocatableQty || 0,
      })).filter((item) => item.bestNodeAvailable < item.requested);
      throw conflict('The basket cannot be allocated under the current shipment policy',
        'BASKET_NOT_ALLOCATABLE', { shortages, splitPolicy: availability.policy.splitPolicy });
    }

    const hubById = new Map(selectedHubs.map((hub) => [String(hub._id), hub]));
    const promiseByHub = new Map(selectedHubs.map((hub) => [String(hub._id),
      promiseFor({ hub, serviceability: availability.serviceability, policy: availability.policy, now })]));
    const allocations = normalized.map((item, index) => {
      const node = selectedNodes[index];
      const hub = hubById.get(node.fulfillmentHubId);
      const nodePromise = promiseByHub.get(node.fulfillmentHubId);
      return {
        listingId: item.listingId, quantity: item.qty,
        warehouseId: node.warehouseId,
        fulfillmentHubId: node.fulfillmentHubId,
        warehouseCode: hub.code,
        warehouseName: hub.name,
        availableAtPlan: node.allocatableQty,
        safetyStock: node.safetyStock,
        policySafetyStock: node.policySafetyStock,
        distanceKm: node.distanceKm,
        legacyDefault: node.legacyDefault,
        promiseMinAt: nodePromise.minAt,
        promiseMaxAt: nodePromise.maxAt,
      };
    });
    const shipmentPlans = selectedHubs.map((hub, index) => {
      const hubId = String(hub._id); const hubPromise = promiseByHub.get(hubId);
      return {
        sequence: index + 1, fulfillmentHubId: hubId, warehouseCode: hub.code,
        warehouseName: hub.name, distanceKm: hub.distanceKm,
        promiseMinAt: hubPromise.minAt, promiseMaxAt: hubPromise.maxAt,
        listingIds: allocations.filter((item) => item.fulfillmentHubId === hubId).map((item) => item.listingId),
      };
    });
    const primaryHub = selectedHubs.find((hub) => String(hub._id) === String(preferredHubId)) || selectedHubs[0];
    const promise = {
      minAt: new Date(Math.min(...[...promiseByHub.values()].map((value) => value.minAt.getTime()))),
      maxAt: new Date(Math.max(...[...promiseByHub.values()].map((value) => value.maxAt.getTime()))),
    };
    warehouseAllocationRequests.inc({ strategy: availability.policy.strategy, outcome: 'planned' });
    return {
      policyId: availability.policy._id || null,
      policyVersion: availability.policy.version || 1,
      strategy: availability.policy.strategy,
      splitPolicy: availability.policy.splitPolicy,
      primaryHubId: String(primaryHub._id),
      hub: { id: String(primaryHub._id), code: primaryHub.code, name: primaryHub.name, distanceKm: primaryHub.distanceKm },
      nodeCount: selectedHubs.length,
      split: selectedHubs.length > 1,
      pincode: pincode || null,
      promise,
      shipments: shipmentPlans,
      allocations,
      plannedAt: now,
    };
  }

  async requireHub({ tenantId, hubId }) {
    const hub = await Hub.findOne({ _id: hubId, tenantId, isActive: true, isFulfillmentEnabled: { $ne: false } }).lean();
    if (!hub) throw notFound('Fulfillment hub not found', 'HUB_NOT_FOUND');
    return hub;
  }
}

export { distanceKm, available, promiseFor, combinations };
export default new WarehouseAllocationService();
