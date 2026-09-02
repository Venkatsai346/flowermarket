/**
 * Money helpers — INR in rupees, rounded to 2 decimals (paise precision).
 * All totals are computed here so rounding is consistent everywhere.
 */

export function roundMoney(n) {
  const v = Number(n) || 0;
  return Math.round(v * 100) / 100;
}

export function moneySum(...values) {
  return roundMoney(values.reduce((acc, v) => acc + (Number(v) || 0), 0));
}

export function isMoney(v) {
  return Number.isFinite(Number(v)) && Number(v) >= 0;
}

/** Format for display: '299.00' -> '₹299' (and '₹299.50' when needed). */
export function formatINR(n) {
  const v = roundMoney(n);
  const isWhole = Number.isInteger(v);
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: isWhole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export default { roundMoney, moneySum, isMoney, formatINR };
