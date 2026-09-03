/** Rider delivery workspace metadata + state helpers. */

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

// State machine: PENDING_ACCEPT -> ACCEPTED -> AT_HUB -> IN_TRANSIT -> ARRIVED -> DELIVERED
export const RIDER_STEPS = [
  { key: 'pending_accept', label: 'Offer' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'at_hub', label: 'At hub' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'arrived', label: 'Arrived' },
  { key: 'delivered', label: 'Delivered' },
];

export const RIDER_ACTIVE_STATUSES = ['pending_accept', 'accepted', 'at_hub', 'in_transit', 'arrived'];

export const RIDER_STATUS_FILTERS = [
  ['', 'All deliveries'],
  ['pending_accept', 'Pending accept'],
  ['accepted', 'Accepted'],
  ['at_hub', 'At hub'],
  ['in_transit', 'In transit'],
  ['arrived', 'Arrived'],
  ['delivered', 'Delivered'],
  ['failed', 'Failed'],
  ['cancelled', 'Cancelled'],
];

export const RIDER_AVAILABILITY_OPTIONS = [
  ['available', 'Available'],
  ['busy', 'Busy'],
  ['offline', 'Offline'],
];

export const POD_OPTIONS = [
  ['otp', 'OTP'],
  ['photo', 'Photo URL'],
  ['signature', 'Signature URL'],
];

/**
 * Which action a rider can take from an assignment status.
 * `depart` and `complete` are snake_case on the wire (matching riderActionSchema).
 */
export const RIDER_ACTIONS = {
  pending_accept: ['accept', 'reject'],
  accepted: ['arrive_hub'],
  at_hub: ['depart'],
  in_transit: ['arrive'],
  arrived: ['complete', 'fail'],
  delivered: [],
  failed: [],
  cancelled: [],
};

export const stepIndex = (status) => RIDER_STEPS.findIndex((s) => s.key === status);
