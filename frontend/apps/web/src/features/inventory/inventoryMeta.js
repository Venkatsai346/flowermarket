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
  row,
});

export const adjustPayload = (f) => ({
  type: f.type,
  qtyChange: Number(f.qtyChange),
  reason: String(f.reason || '').trim(),
  note: String(f.note || '').trim() || null,
});

export const emptyHub = () => ({
  name: '',
  code: '',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  pincodes: '',
  defaultSlotCapacity: 25,
  isActive: true,
});

export const hubToForm = (h) => ({
  name: h.name || '',
  code: h.code || '',
  line1: h.address?.line1 || '',
  city: h.address?.city || '',
  state: h.address?.state || '',
  pincode: h.address?.pincode || '',
  pincodes: (h.serviceablePincodes || []).join(', '),
  defaultSlotCapacity: h.defaultSlotCapacity ?? 25,
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
  pincodes: parsePincodes(f.pincodes),
  defaultSlotCapacity: Number(f.defaultSlotCapacity) || 25,
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
  defaultSlotCapacity: Number(f.defaultSlotCapacity) || 25,
});

export const parsePincodes = (raw) => Array.from(new Set(String(raw || '').split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^\d{6}$/.test(s)))).slice(0, 200);
