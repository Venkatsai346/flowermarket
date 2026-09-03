/** Shared display metadata for the after-sales/returns + refunds console. */
import {
  QC_STATUS_META, REFUND_DESTINATION_META, REFUND_REASON_META, REFUND_STATUS_META,
  RETURN_CLAIM_TYPE_META, RETURN_STATUS_META,
} from '@flower-market/shared';

export {
  QC_STATUS_META, REFUND_DESTINATION_META, REFUND_REASON_META, REFUND_STATUS_META,
  RETURN_CLAIM_TYPE_META, RETURN_STATUS_META,
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
