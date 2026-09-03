/** Shared display metadata for the after-sales/returns + refunds console. */

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

export const RETURN_FILTERS = [
  ['', 'All statuses'],
  ['approved', 'Approved (to pick up)'],
  ['picked_up', 'Picked up (to QC)'],
  ['qc_passed', 'QC passed'],
  ['qc_failed', 'QC failed'],
  ['refund_initiated', 'Refund initiated'],
  ['refunded', 'Refunded'],
  ['rejected', 'Rejected'],
];

export const REFUND_FILTERS = [
  ['', 'All statuses'],
  ['pending', 'Pending'],
  ['success', 'Success'],
  ['failed', 'Failed'],
];

export const REFUND_REASON_OPTIONS = [
  ['order_cancelled', 'Order cancelled'],
  ['return_qc_passed', 'Return QC passed'],
  ['instant_claim_approved', 'Instant claim approved'],
  ['delivery_failed', 'Delivery failed'],
  ['admin_override', 'Admin override'],
];

export const REFUND_DESTINATION_OPTIONS = [
  ['wallet', 'Wallet (instant)'],
  ['original_method', 'Original payment method'],
];

export const RETURN_TABS = [
  ['returns', 'Return requests'],
  ['refunds', 'Refunds'],
];
