/** Shared display metadata for the fulfillment ops centre. */
import {
  ASSIGNMENT_STATUS_META, OPS_ORDER_STATUS_META, PAYMENT_METHOD_META, PAYMENT_PROVIDER_META,
  PAYMENT_STATUS_META, SLOT_STATUS_META, TASK_STATUS_META,
} from '@flower-market/shared';

export {
  ASSIGNMENT_STATUS_META, OPS_ORDER_STATUS_META, PAYMENT_METHOD_META, PAYMENT_PROVIDER_META,
  PAYMENT_STATUS_META, SLOT_STATUS_META, TASK_STATUS_META,
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
