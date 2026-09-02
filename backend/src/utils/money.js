/**
 * Money helpers.
 *
 * TWO REPRESENTATIONS LIVE HERE, DELIBERATELY:
 *
 *  1. **Rupee floats** (`roundMoney`, `moneySum`, `formatINR`) — the legacy
 *     representation used by cart/order/invoice totals since Phase 3. Kept
 *     as-is: rewriting 76 models is not worth the risk, and every sum is
 *     already rounded at the boundary.
 *
 *  2. **Integer paise** (`toPaise`, `fromPaise`, `allocatePaise`, `splitTaxPaise`)
 *     — the representation for everything FINANCIAL introduced from Phase 6.1
 *     onward: the double-entry ledger, GST invoices, vendor payouts.
 *
 * Why the split matters (Phase 6.1 rationale):
 *   A float is fine for "what does this cart cost". It is NOT fine for
 *   "CGST + SGST must equal the tax exactly", "the sum of ten vendor payouts
 *   must equal the money we actually hold", or "commission = GMV × bps"
 *   compounded over a hundred thousand lines. Those need exact integers.
 *
 * RULE: paise fields are the source of truth for new financial documents and
 * are suffixed `Paise`. Rupee values derived from them are display/legacy views
 * produced with `fromPaise()` — never the other way around.
 */

// ---------------------------------------------------------------------------
// Legacy: rupees as floats (unchanged behaviour — do not "improve" these)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Phase 6.1: integer paise
// ---------------------------------------------------------------------------

/** Rupees (number|string) -> integer paise. Throws on non-finite input. */
export function toPaise(rupees) {
  const v = Number(rupees);
  if (!Number.isFinite(v)) throw new TypeError(`toPaise: not a finite number: ${rupees}`);
  // Round the scaled value, not the input: 19.99 * 100 === 1998.9999999999998
  return Math.round(v * 100);
}

/** Integer paise -> rupees (2dp float, for legacy fields and display only). */
export function fromPaise(paise) {
  const v = Number(paise);
  if (!Number.isFinite(v)) throw new TypeError(`fromPaise: not a finite number: ${paise}`);
  return Math.round(v) / 100;
}

/** Sum of integer paise (stays exact — no rounding involved). */
export function sumPaise(...values) {
  return values.reduce((acc, v) => acc + Math.round(Number(v) || 0), 0);
}

/** '₹1,299.50' from 129950 paise. */
export function formatPaise(paise) {
  return formatINR(fromPaise(paise));
}

/**
 * Largest-remainder ("Hamilton") allocation.
 *
 * Splits `totalPaise` across `weights` so that the parts sum EXACTLY to the
 * total — no paisa invented, none lost. This is how tax, discount, commission
 * and refund reversals are distributed across order lines.
 *
 * Properties (asserted in scripts/money.test.js):
 *   - sum(result) === totalPaise, always, for any weights
 *   - every part has the same sign as totalPaise (or 0) — never mixed
 *   - deterministic: equal remainders break ties by index, so the same input
 *     always produces the same split (critical for idempotent re-posting)
 *   - zero/negative weights receive 0 (a free line takes no share of the tax)
 *
 * Replaces the previous "last line absorbs the rounding" approach, which is
 * biased toward one line and can hand a negative share to a zero-priced item.
 *
 * @param {number} totalPaise  integer paise, may be negative (refund reversals)
 * @param {number[]} weights   non-negative weights (typically line values)
 * @returns {number[]} integer paise, same length as `weights`
 */
export function allocatePaise(totalPaise, weights) {
  const total = Math.round(Number(totalPaise) || 0);
  const w = (weights || []).map((x) => {
    const n = Number(x) || 0;
    return n > 0 ? n : 0;
  });
  if (w.length === 0) return [];
  if (total === 0) return w.map(() => 0);

  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);
  const weightSum = w.reduce((a, b) => a + b, 0);

  // No usable weights: put everything on the first slot rather than losing it.
  if (weightSum <= 0) return w.map((_, i) => (i === 0 ? total : 0));

  const exact = w.map((x) => (magnitude * x) / weightSum);
  const parts = exact.map(Math.floor);
  let remainder = magnitude - parts.reduce((a, b) => a + b, 0);

  // Hand the leftover paise to the largest fractional remainders first;
  // ties broken by index so the function is deterministic.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

  for (let k = 0; k < remainder; k += 1) parts[order[k % order.length].i] += 1;

  return parts.map((p) => p * sign);
}

/**
 * Split a GST amount into the CGST/SGST pair for an intra-state supply.
 *
 * Returns `[cgst, sgst]` such that `cgst + sgst === totalTaxPaise` EXACTLY,
 * even for an odd number of paise (the extra paisa goes to SGST by convention).
 * Doing this with integers is what makes `CGST + SGST != tax` — the single most
 * common cause of GSTR-1 mismatches — structurally impossible.
 */
export function splitTaxPaise(totalTaxPaise) {
  const t = Math.round(Number(totalTaxPaise) || 0);
  const half = Math.trunc(t / 2);
  return [half, t - half];
}

/**
 * Basis-point maths on integer paise (commission, TCS, TDS).
 * 100 bps = 1%. Rounds half-up on the absolute value so the result is
 * symmetric for credits and debits.
 */
export function applyBps(basePaise, bps) {
  const base = Math.round(Number(basePaise) || 0);
  const rate = Number(bps) || 0;
  const sign = base < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(base) * rate) / 10000);
}

export default {
  roundMoney,
  moneySum,
  isMoney,
  formatINR,
  toPaise,
  fromPaise,
  sumPaise,
  formatPaise,
  allocatePaise,
  splitTaxPaise,
  applyBps,
};
