/** Shared display metadata for the fulfillment ops centre. */
import {
  ASSIGNMENT_STATUS_META, OPS_ORDER_STATUS_META, PAYMENT_METHOD_META, PAYMENT_PROVIDER_META,
  PAYMENT_STATUS_META, SLOT_STATUS_META, TASK_STATUS_META,
} from '@flower-market/shared';

export {
  ASSIGNMENT_STATUS_META, OPS_ORDER_STATUS_META, PAYMENT_METHOD_META, PAYMENT_PROVIDER_META,
  PAYMENT_STATUS_META, SLOT_STATUS_META, TASK_STATUS_META,
};

// Gateway webhook dispositions — `mismatch` (gateway amount ≠ ours) is the
// fraud/misrouting signal an operator pages on; `duplicate` = retried
// delivery that never re-entered the state machine.
export const WEBHOOK_EVENT_STATUS_META = {
  received: { label: 'Received', tone: 'slate' },
  processed: { label: 'Processed', tone: 'emerald' },
  duplicate: { label: 'Duplicate', tone: 'sky' },
  mismatch: { label: 'Mismatch', tone: 'rose' },
  ignored: { label: 'Ignored', tone: 'amber' },
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
