import {
  Ban, BadgeCheck, Clock, HandCoins, Hourglass, RotateCcw, Send, ShieldQuestion, XCircle,
} from 'lucide-react';
import { BANK_META, KYC_META, LINE_STATE_META, PAYOUT_STATE_META as BASE_PAYOUT_STATE_META } from '@flower-market/shared';

/**
 * Shared vocabulary for the payout console.
 *
 * The label/tone vocabulary is shared with mobile; this module only decorates
 * it with the relevant console icon so operators can scan state at a glance.
 */
const PAYOUT_ICONS = {
  draft: Clock,
  pending_approval: Hourglass,
  approved: BadgeCheck,
  queued: Send,
  processing: ShieldQuestion,
  paid: HandCoins,
  failed: XCircle,
  reversed: RotateCcw,
  cancelled: Ban,
  rejected: XCircle,
};

export const PAYOUT_STATE_META = Object.fromEntries(
  Object.entries(BASE_PAYOUT_STATE_META).map(([key, value]) => [key, { ...value, icon: PAYOUT_ICONS[key] }]),
);

export { BANK_META, KYC_META, LINE_STATE_META };

/** States where a human decision is the next step. */
export const NEEDS_ACTION = ['draft', 'pending_approval', 'approved', 'failed'];

/** States where money may already have left — never offer a retry here. */
export const IN_FLIGHT = ['queued', 'processing'];
