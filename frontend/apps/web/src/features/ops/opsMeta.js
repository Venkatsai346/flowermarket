/** Shared display metadata for the fulfillment ops centre. */

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

export const SLOT_STATUS_META = {
  open: { label: 'Open', tone: 'emerald' },
  full: { label: 'Full', tone: 'amber' },
  closed: { label: 'Closed', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};

export const TASK_STATUS_META = {
  queued: { label: 'Queued', tone: 'slate' },
  picking: { label: 'Picking', tone: 'violet' },
  packed: { label: 'Packed', tone: 'violet' },
  failed: { label: 'Failed', tone: 'rose' },
};

export const POD_OPTIONS = [
  ['otp', 'OTP'],
  ['photo', 'Photo URL'],
  ['signature', 'Signature URL'],
];

export const OPS_TABS = [
  ['picking', 'Picking'],
  ['delivery', 'Delivery'],
  ['slots', 'Slots'],
  ['payments', 'Payments'],
];
