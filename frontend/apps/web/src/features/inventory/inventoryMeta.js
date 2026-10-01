/** Inventory + hub/slot display metadata and form converters (matches backend enums). */
import {
  ADJUSTMENT_TYPE_META, INVENTORY_HEALTH_META, SLOT_STATUS_META, SLOT_WINDOW_META,
} from '@flower-market/shared';

export {
  ADJUSTMENT_TYPE_META, INVENTORY_HEALTH_META, SLOT_STATUS_META, SLOT_WINDOW_META,
};

export const INVENTORY_HEALTH_OPTIONS = [
  ['', 'All health'],
  ['in_stock', 'In stock'],
  ['low_stock', 'Low stock'],
  ['out_of_stock', 'Out of stock'],
];

export const ADJUSTMENT_TYPE_OPTIONS = [
  ['restock', 'Restock'],
  ['shrinkage', 'Shrinkage'],
  ['audit_correction', 'Audit correction'],
  ['return_restock', 'Return restock'],
];

export const fmtPct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;

export const emptyAdjust = (row) => ({
  type: 'restock',
  qtyChange: '',
  reason: '',
  note: '',
  warehouseId: row?.inventoryNodes?.[0]?.warehouseId || '',
  row,
});

export const adjustPayload = (f) => ({
  type: f.type,
  qtyChange: Number(f.qtyChange),
  reason: String(f.reason || '').trim(),
  note: String(f.note || '').trim() || null,
  ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
});

export const emptyHub = () => ({
  name: '',
  code: '',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  longitude: '',
  latitude: '',
  pincodes: '',
  defaultSlotCapacity: 25,
  fulfillmentPriority: 100,
  handlingTimeMinutes: 30,
  maxDeliveryRadiusKm: '',
  acceptsOverflow: false,
  isFulfillmentEnabled: true,
  isActive: true,
});

export const hubToForm = (h) => ({
  name: h.name || '',
  code: h.code || '',
  line1: h.address?.line1 || '',
  city: h.address?.city || '',
  state: h.address?.state || '',
  pincode: h.address?.pincode || '',
  longitude: h.coordinates?.[0] ?? '',
  latitude: h.coordinates?.[1] ?? '',
  pincodes: (h.serviceablePincodes || []).join(', '),
  defaultSlotCapacity: h.defaultSlotCapacity ?? 25,
  fulfillmentPriority: h.fulfillmentPriority ?? 100,
  handlingTimeMinutes: h.handlingTimeMinutes ?? 30,
  maxDeliveryRadiusKm: h.maxDeliveryRadiusKm ?? '',
  acceptsOverflow: Boolean(h.acceptsOverflow),
  isFulfillmentEnabled: h.isFulfillmentEnabled !== false,
  isActive: Boolean(h.isActive),
});

export const hubCreatePayload = (f) => ({
  name: String(f.name || '').trim(),
  code: String(f.code || '').trim(),
  address: {
    line1: String(f.line1 || '').trim() || null,
    city: String(f.city || '').trim() || null,
    state: String(f.state || '').trim() || null,
    pincode: String(f.pincode || '').trim() || null,
  },
  coordinates: f.longitude !== '' && f.latitude !== '' ? [Number(f.longitude), Number(f.latitude)] : undefined,
  pincodes: parsePincodes(f.pincodes),
  defaultSlotCapacity: Number(f.defaultSlotCapacity) || 25,
  fulfillmentPriority: Number(f.fulfillmentPriority) || 100,
  handlingTimeMinutes: Number(f.handlingTimeMinutes) || 0,
  maxDeliveryRadiusKm: f.maxDeliveryRadiusKm === '' ? null : Number(f.maxDeliveryRadiusKm),
  acceptsOverflow: Boolean(f.acceptsOverflow),
  isFulfillmentEnabled: Boolean(f.isFulfillmentEnabled),
  isActive: Boolean(f.isActive),
});

export const hubUpdatePayload = (f) => ({
  name: String(f.name || '').trim(),
  address: {
    line1: String(f.line1 || '').trim() || null,
    city: String(f.city || '').trim() || null,
    state: String(f.state || '').trim() || null,
    pincode: String(f.pincode || '').trim() || null,
  },
  coordinates: f.longitude !== '' && f.latitude !== '' ? [Number(f.longitude), Number(f.latitude)] : undefined,
  defaultSlotCapacity: Number(f.defaultSlotCapacity) || 25,
  fulfillmentPriority: Number(f.fulfillmentPriority) || 100,
  handlingTimeMinutes: Number(f.handlingTimeMinutes) || 0,
  maxDeliveryRadiusKm: f.maxDeliveryRadiusKm === '' ? null : Number(f.maxDeliveryRadiusKm),
  acceptsOverflow: Boolean(f.acceptsOverflow),
  isFulfillmentEnabled: Boolean(f.isFulfillmentEnabled),
});

export const parsePincodes = (raw) => Array.from(new Set(String(raw || '').split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^\d{6}$/.test(s)))).slice(0, 200);
