/**
 * afterSales.js — customer-facing vocabulary for returns, refunds and the
 * wallet. Pure data + tiny display helpers only; the server remains the
 * authority on eligibility, amounts and transitions.
 *
 * This is the same discipline as `lib/status.js` (order statuses): the backend
 * speaks machine states, a customer reads a handful of outcomes, and the map is
 * the single place the two meet. No business rules live here.
 */

import { titleCase } from '@flower-market/shared';

/** Standard pick-up return window shown in copy (UI hint only). */
export const RETURN_WINDOW_DAYS = 7;
export const INSTANT_CLAIM_WINDOW_HOURS = 24;

/** Return claim types → customer copy. */
export const RETURN_CLAIM_META = {
  pickup_qc: {
    label: 'Standard return',
    short: 'Pickup',
    description: 'We pick the item up, check it and refund you once it passes QC.',
    tone: 'sky',
  },
  instant_claim: {
    label: 'Instant claim',
    short: 'Instant',
    description: 'For quality issues on fresh items — approved instantly and refunded to your wallet.',
    tone: 'emerald',
  },
};

/** Backend `RETURN_REQUEST_STATUS` → label + tone + customer intent. */
export const RETURN_STATUS_META = {
  requested: { label: 'Return requested', tone: 'bg-slate-100 text-slate-700' },
  approved: { label: 'Return approved', tone: 'bg-sky-100 text-sky-800' },
  rejected: { label: 'Return rejected', tone: 'bg-rose-100 text-rose-800' },
  picked_up: { label: 'Item collected', tone: 'bg-sky-100 text-sky-800' },
  qc_passed: { label: 'Quality check passed', tone: 'bg-emerald-100 text-emerald-800' },
  qc_failed: { label: 'Quality check failed', tone: 'bg-rose-100 text-rose-800' },
  refund_initiated: { label: 'Refund initiated', tone: 'bg-amber-100 text-amber-800' },
  refunded: { label: 'Refunded', tone: 'bg-emerald-100 text-emerald-800' },
  refund_rejected: { label: 'Refund rejected', tone: 'bg-rose-100 text-rose-800' },
};

/** Backend `REFUND_TRANSACTION_STATUS` → label + tone. */
export const REFUND_STATUS_META = {
  pending: { label: 'Refund pending', tone: 'bg-amber-100 text-amber-800' },
  success: { label: 'Refunded', tone: 'bg-emerald-100 text-emerald-800' },
  failed: { label: 'Refund failed', tone: 'bg-rose-100 text-rose-800' },
};

/** Backend `REFUND_DESTINATION` → customer copy. */
export const REFUND_DESTINATION_META = {
  wallet: { label: 'Wallet', short: 'Wallet' },
  original_method: { label: 'Original payment method', short: 'Original method' },
};

/** Backend `REFUND_REASON` → customer copy. */
export const REFUND_REASON_META = {
  order_cancelled: 'Order cancelled',
  return_qc_passed: 'Return quality check passed',
  instant_claim_approved: 'Instant claim approved',
  delivery_failed: 'Delivery failed',
  admin_override: 'Support correction',
};

/** Backend `WALLET_TXN_REASON` → customer copy. */
export const WALLET_TXN_REASON_META = {
  refund: 'Refund',
  goodwill: 'Goodwill credit',
  order_payment: 'Order payment',
  adjustment: 'Adjustment',
};

/** Customer-facing order cancellation reasons (mirrors the backend enum). */
export const CANCEL_REASONS = [
  { code: 'changed_mind', label: 'I changed my mind' },
  { code: 'duplicate_order', label: 'This is a duplicate order' },
  { code: 'wrong_details', label: 'I entered the wrong details' },
  { code: 'delivery_too_late', label: 'Delivery would be too late' },
  { code: 'other', label: 'Something else' },
];

/** Common return reasons (display copy, sent as `reason`; `code` as reasonCode). */
export const RETURN_REASONS = [
  { code: 'damaged', label: 'Damaged or broken' },
  { code: 'wilted', label: 'Wilted or not fresh' },
  { code: 'wrong_item', label: 'Wrong item delivered' },
  { code: 'not_as_described', label: 'Not as described' },
  { code: 'quality_issue', label: 'Quality issue' },
  { code: 'no_longer_needed', label: 'No longer needed' },
  { code: 'other', label: 'Other' },
];

/** True when the backend's `cancellationAllowed()` would consider the order. */
export function canCancel(status) {
  return [
    'created', 'payment_pending', 'confirmed', 'picking', 'packed', 'delivery_failed',
  ].includes(status);
}

/** Remaining returnable quantity for an order item. */
export function remainingQty(item) {
  const qty = Number(item?.qty) || 0;
  const returned = Number(item?.returnedQty) || 0;
  return Math.max(0, qty - returned);
}

/** Whether a line can be returned on a pickup/QC return. */
export function canPickupReturn(item) {
  return Boolean(item?.isReturnable) && remainingQty(item) > 0;
}

/** Whether an order can start a return at all. */
export function canReturn(order, items = []) {
  return order?.status === 'delivered' && items?.some((i) => remainingQty(i) > 0);
}

/** Map any status to a fallback label/tone (never breaks the UI). */
export function meta(value, map) {
  return map?.[value] || { label: titleCase(value), tone: 'bg-slate-100 text-slate-700' };
}

/** `+₹` / `−₹` for wallet ledger lines without letting the Money component sign. */
export function signedMoney(amount, type) {
  const n = Number(amount) || 0;
  return `${type === 'debit' ? '−' : '+'}₹${Math.abs(n).toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
