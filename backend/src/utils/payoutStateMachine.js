import { AppError } from './ApiError.js';
import { PAYOUT_STATE } from '../constants/enums.js';

/**
 * payoutStateMachine — the only legal paths a payout batch may take.
 *
 * Modelled exactly on `utils/orderStateMachine.js`: a frozen adjacency map and
 * an assert function, so an illegal transition is a 400 with a machine-readable
 * code rather than a silently corrupted record.
 *
 * Why a batch needs one at all: "mark it paid" is a single line of code, and
 * the difference between a marketplace that pays correctly and one that pays
 * twice is whether that line can run from the wrong starting state. Every
 * transition below was chosen for a reason:
 *
 *   DRAFT           freshly computed; still recomputable
 *   PENDING_APPROVAL submitted for a human decision (money leaves next)
 *   APPROVED        a human said yes; not yet handed to the bank
 *   QUEUED          accepted for dispatch
 *   PROCESSING      the provider has it — THE DANGEROUS STATE. A batch here
 *                   may or may not have moved money, so it can only leave via
 *                   RECONCILIATION, never via a retry. That is why there is no
 *                   PROCESSING -> QUEUED edge.
 *   PAID            provider confirmed
 *   FAILED          provider rejected before moving money → safe to retry
 *   REVERSED        the bank returned it after PAID → liability restored
 */
export const PAYOUT_TRANSITIONS = Object.freeze({
  [PAYOUT_STATE.DRAFT]: [PAYOUT_STATE.PENDING_APPROVAL, PAYOUT_STATE.CANCELLED],
  [PAYOUT_STATE.PENDING_APPROVAL]: [PAYOUT_STATE.APPROVED, PAYOUT_STATE.REJECTED, PAYOUT_STATE.CANCELLED],
  [PAYOUT_STATE.APPROVED]: [PAYOUT_STATE.QUEUED, PAYOUT_STATE.CANCELLED],
  [PAYOUT_STATE.QUEUED]: [PAYOUT_STATE.PROCESSING, PAYOUT_STATE.CANCELLED],
  // deliberately NO route back to QUEUED: an in-flight payout is resolved by
  // reconciliation, never by re-submitting it.
  [PAYOUT_STATE.PROCESSING]: [PAYOUT_STATE.PAID, PAYOUT_STATE.FAILED],
  [PAYOUT_STATE.PAID]: [PAYOUT_STATE.REVERSED],
  [PAYOUT_STATE.FAILED]: [PAYOUT_STATE.QUEUED, PAYOUT_STATE.CANCELLED],
  [PAYOUT_STATE.REVERSED]: [],
  [PAYOUT_STATE.CANCELLED]: [],
  [PAYOUT_STATE.REJECTED]: [PAYOUT_STATE.DRAFT], // fix the numbers and resubmit
});

/** States from which no further movement is possible. */
export const PAYOUT_TERMINAL = Object.freeze([
  PAYOUT_STATE.REVERSED, PAYOUT_STATE.CANCELLED,
]);

/** States in which money may already have left the building. */
export const PAYOUT_IN_FLIGHT = Object.freeze([
  PAYOUT_STATE.PROCESSING,
]);

export function canTransition(from, to) {
  return (PAYOUT_TRANSITIONS[from] || []).includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new AppError(`Payout cannot move from ${from} to ${to}`, {
      status: 400,
      code: 'INVALID_PAYOUT_TRANSITION',
      details: { from, to, allowed: PAYOUT_TRANSITIONS[from] || [] },
    });
  }
  return true;
}

export default { PAYOUT_TRANSITIONS, PAYOUT_TERMINAL, PAYOUT_IN_FLIGHT, canTransition, assertTransition };
