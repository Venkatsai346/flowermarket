/**
 * Shared status/metadata vocabulary for web + mobile.
 *
 * Pure label/tone maps only — no React components, no icon imports. This keeps
 * the mobile app and the console aligned on the same vocabulary while the web
 * layer is free to add icons or richer view models locally.
 */

// ---------------- commerce (were in utils/format.js) ----------------
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

// ---------------- catalog taxonomy ----------------
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

// ---------------- after-sales ----------------
export const RETURN_STATUS_META = {
  requested: { label: 'Requested', tone: 'amber' },
  approved: { label: 'Approved', tone: 'sky' },
  rejected: { label: 'Rejected', tone: 'slate' },
  picked_up: { label: 'Picked up', tone: 'violet' },
  qc_passed: { label: 'QC passed', tone: 'emerald' },
  qc_failed: { label: 'QC failed', tone: 'rose' },
  refund_initiated: { label: 'Refund initiated', tone: 'violet' },
  refunded: { label: 'Refunded', tone: 'emerald' },
  refund_rejected: { label: 'Refund rejected', tone: 'slate' },
};

export const RETURN_CLAIM_TYPE_META = {
  pickup_qc: { label: 'Pickup + QC', tone: 'sky' },
  instant_claim: { label: 'Instant claim', tone: 'emerald' },
};

export const QC_STATUS_META = {
  pending: { label: 'Pending', tone: 'amber' },
  passed: { label: 'Passed', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
};

export const REFUND_STATUS_META = {
  pending: { label: 'Pending', tone: 'amber' },
  success: { label: 'Success', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
};

export const REFUND_DESTINATION_META = {
  wallet: { label: 'Wallet', tone: 'emerald' },
  original_method: { label: 'Original method', tone: 'sky' },
};

export const REFUND_REASON_META = {
  order_cancelled: { label: 'Order cancelled', tone: 'slate' },
  return_qc_passed: { label: 'Return QC passed', tone: 'emerald' },
  instant_claim_approved: { label: 'Instant claim approved', tone: 'violet' },
  delivery_failed: { label: 'Delivery failed', tone: 'amber' },
  admin_override: { label: 'Admin override', tone: 'rose' },
};

// ---------------- catalog console ----------------
export const LISTING_STATUS_META = {
  draft: { label: 'Draft', tone: 'slate' },
  active: { label: 'Active', tone: 'emerald' },
  inactive: { label: 'Inactive', tone: 'rose' },
  out_of_stock: { label: 'Out of stock', tone: 'amber' },
};

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

// ---------------- inventory + hubs ----------------
export const INVENTORY_HEALTH_META = {
  in_stock: { label: 'In stock', tone: 'emerald' },
  low_stock: { label: 'Low stock', tone: 'amber' },
  out_of_stock: { label: 'Out of stock', tone: 'rose' },
};

export const ADJUSTMENT_TYPE_META = {
  restock: { label: 'Restock', tone: 'emerald' },
  shrinkage: { label: 'Shrinkage', tone: 'rose' },
  audit_correction: { label: 'Audit correction', tone: 'sky' },
  return_restock: { label: 'Return restock', tone: 'violet' },
};

export const SLOT_STATUS_META = {
  open: { label: 'Open', tone: 'emerald' },
  closed: { label: 'Closed', tone: 'rose' },
  full: { label: 'Full', tone: 'amber' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

export const SLOT_WINDOW_META = {
  normal: { label: 'Normal', tone: 'sky' },
  express: { label: 'Express', tone: 'amber' },
};

// ---------------- fulfillment ops ----------------
export const OPS_ORDER_STATUS_META = {
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
  qc_passed: { label: 'QC passed', tone: 'emerald' },
  qc_failed: { label: 'QC failed', tone: 'rose' },
  refund_initiated: { label: 'Refund initiated', tone: 'violet' },
  refund_rejected: { label: 'Refund rejected', tone: 'slate' },
  refunded: { label: 'Refunded', tone: 'emerald' },
};

export const PAYMENT_STATUS_META = {
  pending: { label: 'Pending', tone: 'amber' },
  success: { label: 'Success', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
  refunded: { label: 'Refunded', tone: 'slate' },
  partially_refunded: { label: 'Partially refunded', tone: 'violet' },
};

export const PAYMENT_METHOD_META = {
  upi: { label: 'UPI', tone: 'sky' },
  card: { label: 'Card', tone: 'violet' },
  netbanking: { label: 'Netbanking', tone: 'sky' },
  wallet: { label: 'Wallet', tone: 'emerald' },
  cod: { label: 'COD', tone: 'amber' },
};

export const PAYMENT_PROVIDER_META = {
  mock: { label: 'Mock gateway', tone: 'slate' },
  razorpay: { label: 'Razorpay', tone: 'violet' },
  wallet: { label: 'Internal wallet', tone: 'emerald' },
};

export const ASSIGNMENT_STATUS_META = {
  pending_accept: { label: 'Pending accept', tone: 'amber' },
  accepted: { label: 'Accepted', tone: 'sky' },
  at_hub: { label: 'At hub', tone: 'violet' },
  in_transit: { label: 'In transit', tone: 'sky' },
  arrived: { label: 'Arrived', tone: 'emerald' },
  delivered: { label: 'Delivered', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

export const TASK_STATUS_META = {
  queued: { label: 'Queued', tone: 'slate' },
  picking: { label: 'Picking', tone: 'violet' },
  packed: { label: 'Packed', tone: 'violet' },
  failed: { label: 'Failed', tone: 'rose' },
};

// ---------------- payouts (base vocabulary; web may add icons) ----------------
export const PAYOUT_STATE_META = {
  draft: { label: 'Draft', tone: 'slate' },
  pending_approval: { label: 'Awaiting approval', tone: 'amber' },
  approved: { label: 'Approved', tone: 'sky' },
  queued: { label: 'Queued', tone: 'sky' },
  processing: { label: 'In flight', tone: 'orange' },
  paid: { label: 'Paid', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
  reversed: { label: 'Reversed', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
  rejected: { label: 'Rejected', tone: 'rose' },
};

export const LINE_STATE_META = {
  accrued: { label: 'Accruing', tone: 'slate' },
  eligible: { label: 'Eligible', tone: 'emerald' },
  held: { label: 'Held', tone: 'amber' },
  batched: { label: 'In batch', tone: 'sky' },
  paid: { label: 'Paid', tone: 'emerald' },
  reversed: { label: 'Reversed', tone: 'rose' },
};

export const KYC_META = {
  not_submitted: { label: 'Not submitted', tone: 'slate' },
  pending: { label: 'Under review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'emerald' },
  rejected: { label: 'Rejected', tone: 'rose' },
};

export const BANK_META = {
  unverified: { label: 'Unverified', tone: 'slate' },
  pending: { label: 'Verifying', tone: 'amber' },
  verified: { label: 'Verified', tone: 'emerald' },
  failed: { label: 'Verification failed', tone: 'rose' },
};

// ---------------- platform lifecycle / ops ----------------
export const KYC_STATUS_META = {
  not_submitted: { label: 'Not submitted', tone: 'slate' },
  pending: { label: 'Pending review', tone: 'amber' },
  approved: { label: 'Approved', tone: 'emerald' },
  rejected: { label: 'Rejected', tone: 'rose' },
};

export const BANK_VERIFICATION_META = {
  unverified: { label: 'Unverified', tone: 'slate' },
  pending: { label: 'Pending', tone: 'amber' },
  verified: { label: 'Verified', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
};

export const EXPORT_STATUS_META = {
  pending: { label: 'Pending', tone: 'amber' },
  running: { label: 'Running', tone: 'sky' },
  done: { label: 'Done', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
};

export const EXPORT_TYPE_LABELS = {
  analytics_daily: 'Analytics daily',
  orders: 'Orders',
  inventory: 'Inventory',
  products: 'Products',
  users: 'Users',
  gstr1_b2b: 'GSTR-1 B2B',
  gstr1_b2cs: 'GSTR-1 B2CS',
  gstr1_hsn: 'GSTR-1 HSN',
  gstr1_cdnr: 'GSTR-1 CDNR',
  gstr8_tcs: 'GSTR-8 TCS',
  tds_194o: 'TDS 194-O',
  payout_statement: 'Payout statement',
  sales_register: 'Sales register',
};

export const TENANT_STATUS_META = {
  active: { label: 'Active', tone: 'emerald' },
  inactive: { label: 'Inactive', tone: 'slate' },
  blocked: { label: 'Blocked', tone: 'rose' },
  suspended: { label: 'Suspended', tone: 'rose' },
};

export const VENDOR_STATUS_LIFECYCLE_META = {
  active: { label: 'Active', tone: 'emerald' },
  suspended: { label: 'Suspended', tone: 'rose' },
};

// ---------------- policies ----------------
export const DISCOUNT_TYPE_META = {
  flat: { label: 'Flat ₹', tone: 'sky' },
  percent: { label: 'Percent %', tone: 'violet' },
};

export const COUPON_STATUS_META = {
  active: { label: 'Active', tone: 'emerald' },
  disabled: { label: 'Disabled', tone: 'slate' },
  expired: { label: 'Expired', tone: 'amber' },
};

export const REFUND_FEE_POLICY_META = {
  never: { label: 'Never refund fee', tone: 'slate' },
  full_order_return_only: { label: 'On full-order return only', tone: 'sky' },
  always: { label: 'Always refund fee', tone: 'emerald' },
};

// ---------------- rider ----------------
export const RIDER_ASSIGNMENT_STATUS_META = {
  pending_accept: { label: 'Pending accept', tone: 'amber' },
  accepted: { label: 'Accepted', tone: 'sky' },
  at_hub: { label: 'At hub', tone: 'violet' },
  in_transit: { label: 'In transit', tone: 'sky' },
  arrived: { label: 'Arrived', tone: 'emerald' },
  delivered: { label: 'Delivered', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

export const RIDER_AVAILABILITY_META = {
  available: { label: 'Available', tone: 'emerald' },
  busy: { label: 'Busy', tone: 'amber' },
  offline: { label: 'Offline', tone: 'slate' },
};

export const RIDER_POD_TYPE_META = {
  otp: { label: 'OTP', tone: 'sky' },
  photo: { label: 'Photo', tone: 'violet' },
  signature: { label: 'Signature', tone: 'emerald' },
};

// ---------------- search ----------------
export const SYNONYM_TYPE_META = {
  equivalent: { label: 'Equivalent', tone: 'emerald' },
  oneway: { label: 'One-way', tone: 'sky' },
};

// ---------------- tax ----------------
export const TAX_DOC_TYPE_META = {
  invoice: { label: 'Tax invoice', tone: 'sky' },
  credit_note: { label: 'Credit note', tone: 'violet' },
};

export const TAX_DOC_STATUS_META = {
  draft: { label: 'Draft', tone: 'slate' },
  issued: { label: 'Issued', tone: 'emerald' },
  cancelled: { label: 'Cancelled', tone: 'rose' },
};

export const EINVOICE_STATUS_META = {
  not_applicable: { label: 'Not applicable', tone: 'slate' },
  pending: { label: 'Pending', tone: 'amber' },
  generated: { label: 'Generated', tone: 'emerald' },
  failed: { label: 'Failed', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

export const TAX_REGISTRATION_TYPE_META = {
  regular: { label: 'Regular', tone: 'emerald' },
  composition: { label: 'Composition', tone: 'sky' },
  unregistered: { label: 'Unregistered', tone: 'slate' },
};

export const TAX_NATURE_OF_SUPPLY_META = {
  taxable: { label: 'Taxable', tone: 'emerald' },
  nil_rated: { label: 'Nil-rated', tone: 'sky' },
  exempt: { label: 'Exempt', tone: 'violet' },
  zero_rated: { label: 'Zero-rated (export/SEZ)', tone: 'amber' },
  non_gst: { label: 'Non-GST', tone: 'slate' },
};

export const STATUTORY_RATE_KIND_META = {
  tcs_gst_52: { label: 'TCS — GST s.52', tone: 'rose' },
  tds_194o: { label: 'TDS — IT s.194-O', tone: 'sky' },
};

export const CREDIT_NOTE_REASON_META = {
  return: { label: 'Return', tone: 'emerald' },
  cancellation: { label: 'Cancellation', tone: 'rose' },
  price_revision: { label: 'Price revision', tone: 'violet' },
  deficiency: { label: 'Deficiency', tone: 'amber' },
  other: { label: 'Other', tone: 'slate' },
};

export const STATUTORY_APPLIES_TO_META = {
  net_taxable: { label: 'Net taxable value', tone: 'sky' },
  gross_sales: { label: 'Gross sales', tone: 'violet' },
};

// ---------------- users ----------------
export const USER_ROLE_META = {
  customer: { label: 'Customer', tone: 'sky' },
  vendor: { label: 'Vendor', tone: 'violet' },
  admin: { label: 'Admin', tone: 'emerald' },
  super_admin: { label: 'Super admin', tone: 'rose' },
  picker: { label: 'Picker', tone: 'amber' },
  rider: { label: 'Rider', tone: 'orange' },
};

export const USER_STATUS_META = {
  active: { label: 'Active', tone: 'emerald' },
  inactive: { label: 'Inactive', tone: 'slate' },
  deleted: { label: 'Deleted', tone: 'slate' },
  verification_pending: { label: 'Verification pending', tone: 'amber' },
  blocked: { label: 'Blocked', tone: 'rose' },
};
