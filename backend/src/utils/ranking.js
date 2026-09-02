/**
 * ranking.js — PURE search relevance scoring (Phase 6.5 / S1).
 *
 * No database, no config, no clock beyond an injectable `now` — so
 * `scripts/ranking.test.js` can prove the ordering properties exhaustively.
 *
 * ── Why a scoring FUNCTION and not a sort key ───────────────────────────────
 * The current catalogue sorts by one column at a time; `sort=relevance` is
 * literally `{ 'master.searchText': -1 }`, i.e. alphabetical. Real relevance is
 * a weighted blend of several signals, and the weights differ per store — a
 * florist selling perishables wants freshness to matter far more than a
 * hardware shop does. So the blend lives here, the weights live in the
 * database (`RankingProfile`), and an operator can retune without a deploy.
 *
 * ── The signals, and why each one earns its place ───────────────────────────
 *   text        how well the query matches the words (the baseline)
 *   popularity  log-damped 30-day sales — damped because a product with 10 000
 *               sales is not 100× better than one with 100
 *   ctr         Bayesian-smoothed click-through — smoothing is what stops a
 *               product with 1 click and 1 impression outranking everything
 *   availability out-of-stock is DEMOTED, never filtered: a customer searching
 *               for something you briefly lack should still see it exists
 *   freshness   exponential decay on age — decisive for cut flowers
 *   margin      a business signal, deliberately small and always disclosed
 *   vendor      seller rating, so a bad seller cannot buy the top slot
 *   promoted    an explicit, time-boxed boost
 *   penalty     recent returns pull a product down
 *
 * Every component is normalised to 0..1 BEFORE weighting, so a weight is
 * directly comparable to every other weight — which is what makes the tuning
 * UI honest.
 */

/** Clamp to 0..1. */
const unit = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * Log damping: maps an unbounded count into 0..1 against a reference "very
 * good" value. `log1p` so the first few sales matter most.
 */
export function logDamp(value, reference = 1000) {
  const v = Math.max(0, Number(value) || 0);
  const ref = Math.max(1, Number(reference) || 1);
  return unit(Math.log1p(v) / Math.log1p(ref));
}

/**
 * Bayesian-smoothed click-through rate.
 *
 * A raw CTR of 1/1 is not better than 480/1000, but a naive ratio says it is.
 * Smoothing pulls small samples toward the prior until they earn their
 * position. `prior` is the platform-average CTR; `weight` is how many
 * impressions of evidence it takes to move away from it.
 */
export function smoothedCtr(clicks, impressions, { prior = 0.08, weight = 50 } = {}) {
  const c = Math.max(0, Number(clicks) || 0);
  const i = Math.max(0, Number(impressions) || 0);
  return unit((c + prior * weight) / (i + weight));
}

/**
 * Exponential freshness decay. `halfLifeHours` is how long until a product is
 * worth half as much in the ranking — hours for cut flowers, weeks for pots.
 */
export function freshnessDecay(ageHours, halfLifeHours = 72) {
  const age = Math.max(0, Number(ageHours) || 0);
  const hl = Math.max(1, Number(halfLifeHours) || 1);
  return unit(2 ** (-age / hl));
}

/**
 * Availability as a GRADIENT, not a filter.
 * in stock → 1, low stock → 0.75, out of stock → 0.
 */
export function availabilityScore(stockQty, { lowThreshold = 5 } = {}) {
  const q = Number(stockQty) || 0;
  if (q <= 0) return 0;
  if (q <= lowThreshold) return 0.75;
  return 1;
}

/** Discount depth normalised against a "deep discount" reference. */
export function discountScore(pricePaise, mrpPaise, { reference = 0.4 } = {}) {
  const p = Number(pricePaise) || 0;
  const m = Number(mrpPaise) || 0;
  if (m <= 0 || p <= 0 || p >= m) return 0;
  return unit(((m - p) / m) / reference);
}

/** Default weights — the platform baseline a store's profile overrides. */
export const DEFAULT_WEIGHTS = Object.freeze({
  text: 1.0,
  popularity: 0.6,
  ctr: 0.5,
  availability: 0.8,
  freshness: 0.4,
  discount: 0.2,
  vendor: 0.2,
  margin: 0.1,
});

export const DEFAULT_TUNING = Object.freeze({
  popularityReference: 1000,
  ctrPrior: 0.08,
  ctrWeight: 50,
  freshnessHalfLifeHours: 72,
  lowStockThreshold: 5,
  promotedBoost: 0.25,
  returnPenalty: 0.3,
  outOfStockFloor: true, // an in-stock item ALWAYS outranks an identical out-of-stock one
});

/**
 * Score one candidate.
 *
 * @param {object} doc     a SearchDocument-shaped row
 * @param {object} opts    { weights, tuning, textScore (0..1), now }
 * @returns {{score:number, components:object}}
 *          `components` is returned so the admin tuner can EXPLAIN a ranking —
 *          "why is this third?" must have an answer.
 */
export function scoreDocument(doc, {
  weights = DEFAULT_WEIGHTS,
  tuning = DEFAULT_TUNING,
  textScore = 0,
  now = Date.now(),
} = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const t = { ...DEFAULT_TUNING, ...tuning };

  const ageHours = doc.listedAt ? (now - new Date(doc.listedAt).getTime()) / 3600000 : 9999;

  const components = {
    text: unit(textScore),
    popularity: logDamp(doc.soldCount30d, t.popularityReference),
    ctr: smoothedCtr(doc.clicks30d, doc.impressions30d, { prior: t.ctrPrior, weight: t.ctrWeight }),
    availability: availabilityScore(doc.stockQty, { lowThreshold: t.lowStockThreshold }),
    freshness: freshnessDecay(ageHours, t.freshnessHalfLifeHours),
    discount: discountScore(doc.pricePaise, doc.mrpPaise),
    vendor: unit((Number(doc.vendorRating) || 0) / 5),
    margin: unit(Number(doc.marginScore) || 0),
  };

  let score = 0;
  for (const key of Object.keys(components)) score += (w[key] ?? 0) * components[key];

  // ---- explicit, bounded adjustments ----
  const promoted = doc.isPromoted && (!doc.promotedUntil || new Date(doc.promotedUntil).getTime() > now);
  if (promoted) score += t.promotedBoost;

  const returnRate = Number(doc.returnRate30d) || 0;
  if (returnRate > 0) score -= t.returnPenalty * unit(returnRate);

  /**
   * The out-of-stock floor. Without it, a hugely popular sold-out product can
   * still outrank an in-stock alternative purely on popularity — which is the
   * single most infuriating search result in commerce. Sold-out items are
   * compressed below every in-stock item while keeping their relative order.
   */
  if (t.outOfStockFloor && components.availability === 0) {
    score = score * 0.15 - 1;
  }

  return { score: Number(score.toFixed(6)), components, promoted };
}

/**
 * Rank a candidate set.
 *
 * Ties break by popularity, then by `_id` — deterministic ordering matters:
 * pagination over a non-deterministic sort silently duplicates and drops rows.
 */
export function rankDocuments(docs, opts = {}) {
  const scored = docs.map((doc) => {
    const { score, components, promoted } = scoreDocument(doc, {
      ...opts,
      textScore: opts.textScores?.get?.(String(doc._id ?? doc.id)) ?? opts.textScore ?? 0,
    });
    return { doc, score, components, promoted };
  });

  scored.sort((a, b) => (
    b.score - a.score
    || (b.doc.soldCount30d || 0) - (a.doc.soldCount30d || 0)
    || String(a.doc._id ?? a.doc.id).localeCompare(String(b.doc._id ?? b.doc.id))
  ));

  return scored;
}

/**
 * Editorial overrides, applied AFTER scoring.
 * `pins` force positions (merchandising, sponsorships, seasonal pushes);
 * `buries` push items to the end without removing them.
 */
export function applyEditorial(ranked, { pins = [], buries = [] } = {}) {
  if (!pins.length && !buries.length) return ranked;
  const pinSet = new Set(pins.map(String));
  const burySet = new Set(buries.map(String));
  const idOf = (r) => String(r.doc.listingId ?? r.doc._id ?? r.doc.id);

  const pinned = [];
  const normal = [];
  const buried = [];
  for (const r of ranked) {
    const id = idOf(r);
    if (pinSet.has(id)) pinned.push(r);
    else if (burySet.has(id)) buried.push(r);
    else normal.push(r);
  }
  // keep the caller's pin order, not the score order
  pinned.sort((a, b) => pins.map(String).indexOf(idOf(a)) - pins.map(String).indexOf(idOf(b)));
  return [...pinned, ...normal, ...buried];
}

/**
 * Deterministic A/B bucketing.
 *
 * Hashes a stable session key so the SAME visitor always lands in the same
 * bucket — a customer who sees a different ranking on every page load is not
 * an experiment, they are a bug.
 */
export function bucketFor(sessionKey, trafficPct = 0) {
  if (!trafficPct || trafficPct <= 0) return false;
  if (trafficPct >= 100) return true;
  const key = String(sessionKey || 'anon');
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 100) < trafficPct;
}

// ---------------------------------------------------------------------------
// offline evaluation
// ---------------------------------------------------------------------------

/**
 * Discounted Cumulative Gain. Relevance grades are 0..3; the log discount
 * encodes that position 1 matters far more than position 10.
 */
export function dcg(grades) {
  return grades.reduce((sum, g, i) => sum + ((2 ** (Number(g) || 0)) - 1) / Math.log2(i + 2), 0);
}

/** NDCG@k — DCG against the best possible ordering of the same grades. */
export function ndcg(grades, k = 10) {
  const top = grades.slice(0, k);
  const ideal = [...grades].sort((a, b) => b - a).slice(0, k);
  const idealDcg = dcg(ideal);
  return idealDcg === 0 ? 0 : Number((dcg(top) / idealDcg).toFixed(6));
}

/** Mean Reciprocal Rank — how far down the first relevant result sits. */
export function mrr(grades, threshold = 1) {
  const idx = grades.findIndex((g) => (Number(g) || 0) >= threshold);
  return idx === -1 ? 0 : Number((1 / (idx + 1)).toFixed(6));
}

/** Recall@k against the total number of relevant documents. */
export function recallAt(grades, totalRelevant, k = 50) {
  if (!totalRelevant) return 0;
  const found = grades.slice(0, k).filter((g) => (Number(g) || 0) >= 1).length;
  return Number((found / totalRelevant).toFixed(6));
}

export default {
  logDamp,
  smoothedCtr,
  freshnessDecay,
  availabilityScore,
  discountScore,
  scoreDocument,
  rankDocuments,
  applyEditorial,
  bucketFor,
  dcg,
  ndcg,
  mrr,
  recallAt,
  DEFAULT_WEIGHTS,
  DEFAULT_TUNING,
};
