import { ORDER_STATUS, ORDER_CANCELLATION_REASON } from '../constants/enums.js';
import { badRequest } from './ApiError.js';

/**
 * Order state machine — exactly the transitions from the architecture doc.
 * Every transition is validated here BEFORE any saga step runs, and every
 * successful transition writes an OrderStatusHistory row (via the caller).
 */

export const ORDER_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.CREATED]: [ORDER_STATUS.PAYMENT_PENDING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAYMENT_PENDING]: [
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.CANCELLED, // payment failed / timeout
  ],
  [ORDER_STATUS.CONFIRMED]: [
    ORDER_STATUS.PICKING,
    ORDER_STATUS.CANCELLED, // customer/ops cancel before packing
  ],
  [ORDER_STATUS.PICKING]: [
    ORDER_STATUS.PACKED,
    ORDER_STATUS.CANCELLED, // stock unavailable at pick (rare)
  ],
  [ORDER_STATUS.PACKED]: [
    ORDER_STATUS.OUT_FOR_DELIVERY,
    ORDER_STATUS.CANCELLED, // ops cancel before dispatch
  ],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [
    ORDER_STATUS.DELIVERED,
    ORDER_STATUS.DELIVERY_FAILED,
  ],
  [ORDER_STATUS.DELIVERY_FAILED]: [
    ORDER_STATUS.OUT_FOR_DELIVERY, // retry
    ORDER_STATUS.CANCELLED, // max retries exceeded
  ],
  [ORDER_STATUS.DELIVERED]: [
    ORDER_STATUS.RETURN_REQUESTED,
  ],
  // return sub-machine (order-level mirror)
  [ORDER_STATUS.RETURN_REQUESTED]: [
    ORDER_STATUS.RETURN_APPROVED,
    ORDER_STATUS.RETURN_REJECTED,
  ],
  [ORDER_STATUS.RETURN_APPROVED]: [
    ORDER_STATUS.RETURN_PICKED_UP,
    ORDER_STATUS.REFUND_INITIATED, // instant-claim path skips pickup
  ],
  [ORDER_STATUS.RETURN_PICKED_UP]: [
    ORDER_STATUS.QC_PASSED,
    ORDER_STATUS.QC_FAILED,
  ],
  [ORDER_STATUS.QC_PASSED]: [ORDER_STATUS.REFUND_INITIATED],
  [ORDER_STATUS.QC_FAILED]: [ORDER_STATUS.REFUND_REJECTED],
  [ORDER_STATUS.REFUND_INITIATED]: [ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.REFUND_REJECTED]: [],
  [ORDER_STATUS.CANCELLED]: [],
  [ORDER_STATUS.REFUNDED]: [],
});

export function canTransition(from, to) {
  if (from === to) return true;
  const allowed = ORDER_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

/** Validate a transition; throws 400 INVALID_ORDER_TRANSITION otherwise. */
export function assertTransition(from, to, { context = '' } = {}) {
  if (from === to) return true;
  if (!canTransition(from, to)) {
    const msg = context ? `${context}: ` : '';
    throw badRequest(`${msg}Cannot transition order from ${from} to ${to}`, 'INVALID_ORDER_TRANSITION');
  }
  return true;
}

/** Cancellation reasons that are allowed per source status. */
export function cancellationAllowed(status) {
  return [
    ORDER_STATUS.CREATED,
    ORDER_STATUS.PAYMENT_PENDING,
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.PICKING,
    ORDER_STATUS.PACKED,
    ORDER_STATUS.DELIVERY_FAILED,
  ].includes(status);
}

export default { ORDER_TRANSITIONS, canTransition, assertTransition, cancellationAllowed };
