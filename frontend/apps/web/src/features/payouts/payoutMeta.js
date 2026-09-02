import {
  Ban, BadgeCheck, Clock, HandCoins, Hourglass, RotateCcw, Send, ShieldQuestion, XCircle,
} from 'lucide-react';

/**
 * Shared vocabulary for the payout console.
 *
 * The tones are chosen so the ONE state an operator must react to —
 * `processing`, where money may or may not have moved — reads as a warning
 * rather than as progress. Everything else follows the usual traffic light.
 */
export const PAYOUT_STATE_META = {
  draft: { label: 'Draft', tone: 'slate', icon: Clock },
  pending_approval: { label: 'Awaiting approval', tone: 'amber', icon: Hourglass },
  approved: { label: 'Approved', tone: 'sky', icon: BadgeCheck },
  queued: { label: 'Queued', tone: 'sky', icon: Send },
  processing: { label: 'In flight', tone: 'orange', icon: ShieldQuestion },
  paid: { label: 'Paid', tone: 'emerald', icon: HandCoins },
  failed: { label: 'Failed', tone: 'rose', icon: XCircle },
  reversed: { label: 'Reversed', tone: 'rose', icon: RotateCcw },
  cancelled: { label: 'Cancelled', tone: 'slate', icon: Ban },
  rejected: { label: 'Rejected', tone: 'rose', icon: XCircle },
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

/** States where a human decision is the next step. */
export const NEEDS_ACTION = ['draft', 'pending_approval', 'approved', 'failed'];

/** States where money may already have left — never offer a retry here. */
export const IN_FLIGHT = ['queued', 'processing'];
