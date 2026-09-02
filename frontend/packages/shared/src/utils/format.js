/**
 * Status → { label, tone } maps + small string helpers.
 * Tone is a Tailwind palette name consumed by the <Badge> component.
 */

export const ORDER_STATUS_META = {
  created: { label: 'Created', tone: 'slate' },
  payment_pending: { label: 'Payment pending', tone: 'amber' },
  confirmed: { label: 'Confirmed', tone: 'sky' },
  picking: { label: 'Picking', tone: 'violet' },
  packed: { label: 'Packed', tone: 'violet' },
  out_for_delivery: { label: 'Out for delivery', tone: 'sky' },
  delivered: { label: 'Delivered', tone: 'emerald' },
  delivery_failed: { label: 'Delivery failed', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
  return_requested: { label: 'Return requested', tone: 'amber' },
  return_approved: { label: 'Return approved', tone: 'amber' },
  return_rejected: { label: 'Return rejected', tone: 'slate' },
  return_picked_up: { label: 'Return picked up', tone: 'amber' },
  return_received: { label: 'Return received', tone: 'sky' },
  return_refunded: { label: 'Return refunded', tone: 'emerald' },
};

export const INVOICE_STATUS_META = {
  draft: { label: 'Draft', tone: 'slate' },
  open: { label: 'Open', tone: 'sky' },
  paid: { label: 'Paid', tone: 'emerald' },
  overdue: { label: 'Overdue', tone: 'rose' },
  void: { label: 'Void', tone: 'slate' },
};

export const SUBSCRIPTION_STATUS_META = {
  trial: { label: 'Trial', tone: 'sky' },
  active: { label: 'Active', tone: 'emerald' },
  past_due: { label: 'Past due', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

export const APPLICATION_STATUS_META = {
  submitted: { label: 'Submitted', tone: 'sky' },
  under_review: { label: 'Under review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'emerald' },
  rejected: { label: 'Rejected', tone: 'rose' },
};

export const VENDOR_STATUS_META = {
  active: { label: 'Active', tone: 'emerald' },
  suspended: { label: 'Suspended', tone: 'rose' },
};

export const ONBOARDING_META = {
  registered: { label: 'Registered', tone: 'amber' },
  active: { label: 'Live', tone: 'emerald' },
};

export const HEALTH_META = {
  in_stock: { label: 'In stock', tone: 'emerald' },
  low_stock: { label: 'Low stock', tone: 'amber' },
  out_of_stock: { label: 'Out of stock', tone: 'rose' },
};

// ---------------- catalog (shared taxonomy + masters) ----------------
export const PRODUCT_TYPE_META = {
  fresh_flower: { label: 'Fresh flowers', tone: 'rose' },
  dried_flower: { label: 'Dried flowers', tone: 'amber' },
  artificial_flower: { label: 'Artificial flowers', tone: 'violet' },
  flower_bouquet: { label: 'Bouquets', tone: 'sky' },
  flower_arrangement: { label: 'Arrangements', tone: 'sky' },
  plant: { label: 'Plants', tone: 'emerald' },
  seed: { label: 'Seeds', tone: 'emerald' },
  gardening_tool: { label: 'Gardening tools', tone: 'slate' },
  floral_accessory: { label: 'Floral accessories', tone: 'violet' },
  gift: { label: 'Gifts', tone: 'rose' },
  other: { label: 'Other', tone: 'slate' },
};

export const SELLING_UNIT_LABEL = {
  piece: 'Piece',
  stem: 'Stem',
  bunch: 'Bunch',
  bouquet: 'Bouquet',
  box: 'Box',
  bucket: 'Bucket',
  kilogram: 'Kilogram (kg)',
  gram: 'Gram (g)',
  pack: 'Pack',
  pot: 'Pot',
};

export const VARIANT_TYPE_LABEL = {
  weight: 'Weight',
  pack_size: 'Pack size',
  stem_count: 'Stem count',
  color: 'Color',
  size: 'Size',
  flavor: 'Flavor',
  other: 'Other',
};

export const ATTRIBUTE_FIELD_TYPE_LABEL = {
  string: 'Text',
  number: 'Number',
  boolean: 'Yes/No',
  select: 'Dropdown',
  date: 'Date',
};

export const ENTITY_STATUS_META = {
  active: { label: 'Active', tone: 'emerald' },
  inactive: { label: 'Inactive', tone: 'slate' },
  archived: { label: 'Archived', tone: 'slate' },
};

export const BRAND_VERIFICATION_META = {
  pending: { label: 'Pending', tone: 'amber' },
  verified: { label: 'Verified', tone: 'emerald' },
  rejected: { label: 'Rejected', tone: 'rose' },
};

export const ROLE_META = {
  super_admin: { label: 'Platform admin', tone: 'violet' },
  admin: { label: 'Store owner', tone: 'sky' },
  vendor: { label: 'Vendor', tone: 'emerald' },
  customer: { label: 'Customer', tone: 'slate' },
  picker: { label: 'Picker', tone: 'amber' },
  rider: { label: 'Rider', tone: 'amber' },
};

export const PLAN_TONE = {
  free: 'slate',
  pro: 'sky',
  business: 'violet',
};

export const PRODUCT_MASTER_STATUS_META = {
  draft: { label: 'Draft', tone: 'slate' },
  pending: { label: 'Pending review', tone: 'amber' },
  pending_review: { label: 'Pending review', tone: 'amber' },
  active: { label: 'Active', tone: 'emerald' },
  rejected: { label: 'Rejected', tone: 'rose' },
  archived: { label: 'Archived', tone: 'slate' },
};

export const titleCase = (s) =>
  String(s || '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

export const initials = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

export const pickMeta = (map, value) => map[value] || { label: titleCase(value), tone: 'slate' };
