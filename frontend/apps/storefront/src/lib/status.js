/**
 * Customer-facing order vocabulary.
 *
 * The backend state machine has 16 states because operations needs that
 * resolution; a customer needs about six. This map is the translation layer —
 * "picking" and "packed" both read as "being prepared", because the difference
 * is ours to care about, not theirs.
 */
export const STATUS_META = {
  created: { label: 'Placed', tone: 'bg-slate-100 text-slate-700', step: 0 },
  payment_pending: { label: 'Awaiting payment', tone: 'bg-amber-100 text-amber-800', step: 0 },
  confirmed: { label: 'Confirmed', tone: 'bg-sky-100 text-sky-800', step: 1 },
  picking: { label: 'Being prepared', tone: 'bg-sky-100 text-sky-800', step: 2 },
  packed: { label: 'Being prepared', tone: 'bg-sky-100 text-sky-800', step: 2 },
  out_for_delivery: { label: 'On the way', tone: 'bg-violet-100 text-violet-800', step: 3 },
  delivered: { label: 'Delivered', tone: 'bg-emerald-100 text-emerald-800', step: 4 },
  delivery_failed: { label: 'Delivery failed', tone: 'bg-rose-100 text-rose-800', step: 3 },
  cancelled: { label: 'Cancelled', tone: 'bg-slate-200 text-slate-600', step: -1 },
  return_requested: { label: 'Return requested', tone: 'bg-amber-100 text-amber-800', step: 5 },
  return_approved: { label: 'Return approved', tone: 'bg-amber-100 text-amber-800', step: 5 },
  return_rejected: { label: 'Return rejected', tone: 'bg-rose-100 text-rose-800', step: 5 },
  return_picked_up: { label: 'Return collected', tone: 'bg-amber-100 text-amber-800', step: 5 },
  refund_initiated: { label: 'Refund on the way', tone: 'bg-emerald-100 text-emerald-800', step: 5 },
  refund_completed: { label: 'Refunded', tone: 'bg-emerald-100 text-emerald-800', step: 5 },
};

/** The four milestones a customer actually tracks. */
export const TRACK_STEPS = ['Placed', 'Confirmed', 'Being prepared', 'On the way', 'Delivered'];
