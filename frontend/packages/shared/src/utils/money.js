/**
 * Money & number formatting — Indian locale (en-IN), INR.
 * Shared by web console + mobile app.
 */
const inrFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inrFmt0 = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const numFmt = new Intl.NumberFormat('en-IN');

/** ₹1,234.56 */
export const inr = (n) => inrFmt.format(Number(n) || 0);

/** ₹1,235 (no paise) */
export const inr0 = (n) => inrFmt0.format(Number(n) || 0);

/**
 * Integer PAISE → ₹1,234.56.
 *
 * The backend stores and reports money in integer paise (no float drift), so
 * anything reading a `*Paise` field — ledger balances, payout lines, cash
 * exposure — needs this. Using `inr(paise)` instead is the classic bug: it
 * renders ₹124,950.00 for a ₹1,249.50 basket.
 */
export const inrPaise = (paise) => inrFmt.format(Math.round(Number(paise) || 0) / 100);

/** Integer paise → rupees as a NUMBER (for arithmetic, not display). */
export const paiseToRupees = (paise) => Math.round(Number(paise) || 0) / 100;

/** ₹1.2L / ₹3.4Cr / ₹1.2k — compact for KPI cards */
export const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
  return inr0(v);
};

/** 1,23,456 (en-IN grouping) */
export const num = (n) => numFmt.format(Number(n) || 0);

/** 5.00% */
export const pct = (n) => `${(Number(n) || 0).toFixed(2)}%`;

/** basis points → percent: 100 → 1.00% */
export const bpsToPct = (bps) => `${((Number(bps) || 0) / 100).toFixed(2)}%`;

/** round to paise */
export const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** signed ₹ for adjustments: +₹120.00 / -₹45.00 */
export const signedInr = (n) => {
  const v = Number(n) || 0;
  return `${v >= 0 ? '+' : '−'}${inr(Math.abs(v))}`;
};
