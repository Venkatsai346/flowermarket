/** Catalog governance + tenant listing metadata (matches backend enums). */

export const LISTING_STATUS_META = {
  draft: { label: 'Draft', tone: 'slate' },
  active: { label: 'Active', tone: 'emerald' },
  inactive: { label: 'Inactive', tone: 'rose' },
  out_of_stock: { label: 'Out of stock', tone: 'amber' },
};

export const LISTING_STATUS_OPTIONS = Object.entries(LISTING_STATUS_META);

export const CHANGE_REQUEST_TYPE_META = {
  create_master: { label: 'Create master', tone: 'violet', description: 'Tenant proposes a brand-new global SKU' },
  update_global_fields: { label: 'Update global fields', tone: 'sky', description: 'Tenant asks to edit shared catalog fields' },
  add_variant: { label: 'Add variant', tone: 'amber', description: 'Tenant requests a new product variant' },
  update_images: { label: 'Update images', tone: 'sky', description: 'Tenant requests image changes' },
  update_attributes: { label: 'Update attributes', tone: 'violet', description: 'Tenant requests attribute changes' },
  deactivate_master: { label: 'Deactivate master', tone: 'rose', description: 'Tenant asks to soft-remove the global SKU' },
};

export const CHANGE_REQUEST_STATUS_META = {
  pending: { label: 'Pending', tone: 'amber' },
  approved: { label: 'Approved', tone: 'emerald' },
  rejected: { label: 'Rejected', tone: 'rose' },
  needs_changes: { label: 'Needs changes', tone: 'sky' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

export const AUDIT_ACTION_META = {
  create: { label: 'Create', tone: 'emerald' },
  update: { label: 'Update', tone: 'sky' },
  delete: { label: 'Delete', tone: 'rose' },
  status_change: { label: 'Status change', tone: 'amber' },
  price_change: { label: 'Price change', tone: 'violet' },
  stock_change: { label: 'Stock change', tone: 'amber' },
  approve: { label: 'Approve', tone: 'emerald' },
  reject: { label: 'Reject', tone: 'rose' },
  deprecate: { label: 'Deprecate', tone: 'slate' },
  verify: { label: 'Verify', tone: 'sky' },
  import: { label: 'Import', tone: 'violet' },
  reserve: { label: 'Reserve', tone: 'amber' },
  release: { label: 'Release', tone: 'sky' },
  adjust: { label: 'Adjust', tone: 'amber' },
  override: { label: 'Override', tone: 'violet' },
  activate: { label: 'Activate', tone: 'emerald' },
  deactivate: { label: 'Deactivate', tone: 'rose' },
  pincodes: { label: 'Pincodes', tone: 'sky' },
  reopen: { label: 'Reopen', tone: 'emerald' },
  close: { label: 'Close', tone: 'rose' },
  role_change: { label: 'Role change', tone: 'violet' },
  accept: { label: 'Accept', tone: 'emerald' },
  depart: { label: 'Depart', tone: 'sky' },
  reject: { label: 'Reject', tone: 'rose' },
  collect: { label: 'Collect', tone: 'violet' },
  deliver: { label: 'Deliver', tone: 'emerald' },
  return: { label: 'Return', tone: 'amber' },
  refund: { label: 'Refund', tone: 'emerald' },
};

export const ENTITY_TYPE_LABELS = {
  product_master: 'Product master',
  product_change_request: 'Change request',
  tenant_product: 'Listing',
  product_variant: 'Variant',
  product_image: 'Image',
  product_attribute: 'Attributes',
  inventory: 'Inventory',
  hub: 'Hub',
  delivery_slot: 'Delivery slot',
  user: 'User',
  order: 'Order',
  payout: 'Payout',
};

export const EVENT_STATUS_META = {
  pending: { label: 'Pending', tone: 'amber' },
  publishing: { label: 'Publishing', tone: 'sky' },
  published: { label: 'Published', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
};

export const BULK_JOB_STATUS_META = {
  queued: { label: 'Queued', tone: 'amber' },
  running: { label: 'Running', tone: 'sky' },
  completed: { label: 'Completed', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
};

export const BULK_KIND_LABELS = {
  price: 'Price',
  stock: 'Stock',
};

export const fmtRows = (n) => `${Math.round(Number(n) || 0)}`;

/** Compact JSON for review diffs / audit payloads without losing nulls. */
export const fmtJson = (v) => {
  if (v == null) return '—';
  try {
    if (typeof v === 'string') return v;
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

/** A conservative "changed keys" summary for an audit log before/after pair. */
export const changedKeys = (before = null, after = null) => {
  const b = before && typeof before === 'object' ? before : {};
  const a = after && typeof after === 'object' ? after : {};
  if (!before && !after) return [];
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].filter((k) =>
    (a[k] == null && b[k] == null) ? false : String(a[k] ?? '') !== String(b[k] ?? '')
  );
};

export const entityLabel = (t) => ENTITY_TYPE_LABELS[t] || String(t || '').replaceAll('_', ' ');
