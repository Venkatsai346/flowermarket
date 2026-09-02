/**
 * ranking.test.js — PURE search relevance tests (Phase 6.5). No database.
 *
 *   node scripts/ranking.test.js
 *
 * Ranking is the one subsystem where "it looks about right" is the normal
 * standard of proof. These are the properties that must hold regardless of how
 * the weights are tuned — the invariants a merchandiser cannot accidentally
 * break from the admin UI.
 */

import {
  logDamp, smoothedCtr, freshnessDecay, availabilityScore, discountScore,
  scoreDocument, rankDocuments, applyEditorial, bucketFor,
  dcg, ndcg, mrr, recallAt, DEFAULT_WEIGHTS, DEFAULT_TUNING,
} from '../src/utils/ranking.js';
import {
  normalizeQuery, tokenize, extractPriceIntent, extractColourIntent,
  expandSynonyms, editDistance, correctToken, parseQuery, relaxationPlan, textRelevance,
} from '../src/utils/queryUnderstanding.js';

let passed = 0;
let failed = 0;
const failures = [];
const check = (n, ok, d = '') => { if (ok) { passed += 1; console.log(`  ✅ ${n}`); } else { failed += 1; failures.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`); } };
const eq = (n, a, e) => check(n, a === e, `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
const section = (t) => console.log(`\n${t}`);

const HOUR = 3600000;
const NOW = Date.UTC(2026, 8, 2);

const doc = (over = {}) => ({
  _id: over._id || Math.random().toString(36).slice(2, 10),
  title: 'Red Rose Bunch',
  searchText: 'red rose bunch flowers fresh',
  stockQty: 20,
  soldCount30d: 100,
  clicks30d: 40,
  impressions30d: 500,
  pricePaise: 54900,
  mrpPaise: 69900,
  vendorRating: 4,
  marginScore: 0.5,
  listedAt: new Date(NOW - 24 * HOUR).toISOString(),
  returnRate30d: 0,
  isPromoted: false,
  ...over,
});

// ---------------------------------------------------------------------------
section('1. signal normalisers');
// ---------------------------------------------------------------------------
eq('logDamp(0) = 0', logDamp(0), 0);
eq('logDamp(ref) = 1', logDamp(1000, 1000), 1);
check('logDamp is damped: 100 sales is well over a tenth of 1000',
  logDamp(100, 1000) > 0.6, String(logDamp(100, 1000)));
check('logDamp is monotonic', logDamp(500) > logDamp(100) && logDamp(100) > logDamp(10));

check('★ smoothing: 1 click / 1 impression does NOT beat 480/1000',
  smoothedCtr(1, 1) < smoothedCtr(480, 1000),
  `${smoothedCtr(1, 1)} vs ${smoothedCtr(480, 1000)}`);
check('no data falls back to the prior', Math.abs(smoothedCtr(0, 0) - 0.08) < 1e-9);
check('a large sample dominates the prior', Math.abs(smoothedCtr(500, 1000) - 0.5) < 0.03);

eq('freshness at age 0 = 1', freshnessDecay(0, 72), 1);
check('freshness halves at the half-life', Math.abs(freshnessDecay(72, 72) - 0.5) < 1e-9);
check('a week-old cut flower is heavily decayed', freshnessDecay(168, 72) < 0.21);

eq('in stock = 1', availabilityScore(20), 1);
eq('low stock = 0.75', availabilityScore(3), 0.75);
eq('out of stock = 0', availabilityScore(0), 0);

check('discount score rises with depth', discountScore(50000, 100000) > discountScore(90000, 100000));
eq('no MRP means no discount signal', discountScore(50000, 0), 0);
eq('price above MRP is not a discount', discountScore(120000, 100000), 0);

// ---------------------------------------------------------------------------
section('2. THE invariant — an in-stock item always beats a sold-out one');
// ---------------------------------------------------------------------------
{
  // the sold-out product is better on EVERY other signal
  const soldOut = doc({ _id: 'out', stockQty: 0, soldCount30d: 100000, clicks30d: 900, impressions30d: 1000, vendorRating: 5, isPromoted: true });
  const inStock = doc({ _id: 'in', stockQty: 12, soldCount30d: 1, clicks30d: 0, impressions30d: 0, vendorRating: 1, marginScore: 0 });

  const ranked = rankDocuments([soldOut, inStock], { textScore: 1, now: NOW });
  eq('★ the in-stock item ranks first anyway', ranked[0].doc._id, 'in');
  check('★ …and the sold-out one is still SHOWN, not filtered out', ranked.length === 2);

  // and it holds no matter how the weights are tuned
  let violations = 0;
  for (let i = 0; i < 300; i += 1) {
    const weights = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, Math.random() * 2]));
    const r = rankDocuments([soldOut, inStock], { weights, textScore: 1, now: NOW });
    if (r[0].doc._id !== 'in') violations += 1;
  }
  eq('★ 300 random weight configurations, zero violations', violations, 0);
}

// ---------------------------------------------------------------------------
section('3. scoring is explainable and bounded');
// ---------------------------------------------------------------------------
{
  const { score, components } = scoreDocument(doc(), { textScore: 0.9, now: NOW });
  check('every component is returned for the tuner', Object.keys(components).length === 8, Object.keys(components).join(','));
  check('every component is normalised to 0..1',
    Object.values(components).every((v) => v >= 0 && v <= 1), JSON.stringify(components));
  check('the score is finite and positive', Number.isFinite(score) && score > 0, String(score));

  const promoted = scoreDocument(doc({ isPromoted: true }), { textScore: 0.9, now: NOW });
  check('a promotion boosts, by exactly the configured amount',
    Math.abs((promoted.score - score) - DEFAULT_TUNING.promotedBoost) < 1e-6);

  const expired = scoreDocument(doc({ isPromoted: true, promotedUntil: new Date(NOW - HOUR).toISOString() }), { textScore: 0.9, now: NOW });
  check('an EXPIRED promotion does not boost', Math.abs(expired.score - score) < 1e-6);

  const returny = scoreDocument(doc({ returnRate30d: 0.5 }), { textScore: 0.9, now: NOW });
  check('a high return rate penalises', returny.score < score);
}

// ---------------------------------------------------------------------------
section('4. ordering is deterministic (pagination depends on it)');
// ---------------------------------------------------------------------------
{
  const docs = Array.from({ length: 40 }, (_, i) => doc({ _id: `d${String(i).padStart(2, '0')}`, soldCount30d: 100, clicks30d: 10, impressions30d: 100 }));
  const a = rankDocuments(docs, { textScore: 0.5, now: NOW }).map((r) => r.doc._id).join(',');
  const b = rankDocuments([...docs].reverse(), { textScore: 0.5, now: NOW }).map((r) => r.doc._id).join(',');
  eq('★ identical documents rank identically regardless of input order', a, b);
}

// ---------------------------------------------------------------------------
section('5. editorial pins and buries');
// ---------------------------------------------------------------------------
{
  const docs = [doc({ _id: 'a', soldCount30d: 5000 }), doc({ _id: 'b', soldCount30d: 10 }), doc({ _id: 'c', soldCount30d: 900 })];
  const ranked = rankDocuments(docs, { textScore: 0.8, now: NOW });
  const edited = applyEditorial(ranked, { pins: ['b'], buries: ['a'] });
  eq('a pinned item goes first', edited[0].doc._id, 'b');
  eq('a buried item goes last', edited[edited.length - 1].doc._id, 'a');
  eq('nothing is lost', edited.length, 3);
}

// ---------------------------------------------------------------------------
section('6. A/B bucketing is stable per visitor');
// ---------------------------------------------------------------------------
{
  const key = 'session-abc-123';
  const runs = new Set(Array.from({ length: 50 }, () => bucketFor(key, 50)));
  eq('★ the same visitor always gets the same bucket', runs.size, 1);
  eq('0% traffic buckets nobody', bucketFor(key, 0), false);
  eq('100% traffic buckets everybody', bucketFor(key, 100), true);

  const sample = Array.from({ length: 10000 }, (_, i) => bucketFor(`s${i}`, 30)).filter(Boolean).length;
  check(`a 30% split lands near 30% (got ${(sample / 100).toFixed(1)}%)`, Math.abs(sample / 10000 - 0.3) < 0.03);
}

// ---------------------------------------------------------------------------
section('7. query understanding — price and colour intent');
// ---------------------------------------------------------------------------
{
  const a = extractPriceIntent('red roses under 500');
  eq('“under 500” → maxPrice', a.filters.maxPrice, 500);
  eq('…and the price words leave the text query', a.rest, 'red roses');

  eq('“below ₹999”', extractPriceIntent('bouquet below ₹999').filters.maxPrice, 999);
  eq('“above 200”', extractPriceIntent('plants above 200').filters.minPrice, 200);

  const r = extractPriceIntent('gifts 500-1000');
  eq('a range → min', r.filters.minPrice, 500);
  eq('a range → max', r.filters.maxPrice, 1000);

  const c = extractColourIntent('red roses');
  eq('colour extracted', c.filters.colour, 'red');
  eq('…and removed from the text', c.rest, 'roses');
}

// ---------------------------------------------------------------------------
section('8. synonyms — the reason this market needs them');
// ---------------------------------------------------------------------------
{
  const groups = [
    { terms: ['gulab', 'rose', 'roses'], type: 'equivalent' },
    { terms: ['mogra', 'jasmine', 'chameli'], type: 'equivalent' },
    { terms: ['bouquet', 'bunch'], type: 'oneway', from: 'bouquet' },
  ];
  check('“gulab” finds roses', expandSynonyms(['gulab'], groups).includes('rose'));
  check('“rose” finds gulab', expandSynonyms(['rose'], groups).includes('gulab'));
  check('“mogra” finds jasmine', expandSynonyms(['mogra'], groups).includes('jasmine'));
  check('one-way: “bouquet” also matches “bunch”', expandSynonyms(['bouquet'], groups).includes('bunch'));
  check('★ one-way does NOT reverse: “bunch” stays “bunch”',
    !expandSynonyms(['bunch'], groups).includes('bouquet'));
}

// ---------------------------------------------------------------------------
section('9. typo tolerance against the store’s own vocabulary');
// ---------------------------------------------------------------------------
{
  const vocab = ['rose', 'roses', 'jasmine', 'marigold', 'orchid', 'lily', 'bouquet', 'planter'];
  eq('a one-letter slip is corrected', correctToken('rse', vocab).token, 'rose');
  eq('a transposition is corrected', correctToken('rsoe', vocab).token, 'rose');
  eq('a longer typo is corrected', correctToken('marigld', vocab).token, 'marigold');
  eq('a correct word is left alone', correctToken('orchid', vocab).token, 'orchid');
  eq('★ a short token is never SUBSTITUTED (“pot” must not become “hot”)',
    correctToken('pot', ['hot', 'pit', 'cot']).corrected, false);
  eq('…but a short token IS fixed by a missing letter (“rse” → “rose”)',
    correctToken('rse', vocab).token, 'rose');
  eq('a 2-letter token is never corrected', correctToken('ro', vocab).corrected, false);
  eq('an unknown long word is left alone rather than mangled',
    correctToken('zzzzzzzz', vocab).token, 'zzzzzzzz');

  eq('edit distance: identical', editDistance('rose', 'rose'), 0);
  eq('edit distance: substitution', editDistance('rase', 'rose'), 1);
  eq('edit distance: transposition counts as ONE', editDistance('rsoe', 'rose'), 1);
  check('the cap short-circuits', editDistance('abcdefgh', 'zzzz', 2) > 2);
}

// ---------------------------------------------------------------------------
section('10. the full parse');
// ---------------------------------------------------------------------------
{
  const parsed = parseQuery('red gulab bouqet under 800', {
    synonyms: [{ terms: ['gulab', 'rose'], type: 'equivalent' }],
    vocabulary: ['rose', 'gulab', 'bouquet', 'lily'],
  });
  eq('price captured', parsed.filters.maxPrice, 800);
  eq('★ colour is INFERRED intent, not a hard filter', parsed.inferredColour, 'red');
  eq('…so it never narrows the result set', parsed.filters.colour, undefined);
  check('…and it stays in the tokens so it can bias ranking', parsed.tokens.includes('red'), parsed.tokens.join(','));
  check('typo corrected', parsed.corrections.some((c) => c.to === 'bouquet'), JSON.stringify(parsed.corrections));
  check('synonym expanded', parsed.expanded.includes('rose'), parsed.expanded.join(','));
  check('the leftover tokens are the real query', parsed.tokens.includes('gulab'));

  const empty = parseQuery('   ', {});
  check('an empty query is flagged as browse mode', empty.isEmpty);

  const plan = relaxationPlan(parsed);
  check('zero-result recovery drops colour first, then price, then tokens',
    plan[0].drop === 'colour' && plan[1].drop === 'price' && plan[plan.length - 1].drop === 'all',
    JSON.stringify(plan.map((p) => p.drop)));
}

// ---------------------------------------------------------------------------
section('11. text relevance ordering');
// ---------------------------------------------------------------------------
{
  const p = parseQuery('red rose', { vocabulary: ['red', 'rose'] });
  const exact = textRelevance(p, { title: 'red rose', searchText: '' });
  const prefix = textRelevance(p, { title: 'red rose bunch premium', searchText: '' });
  const contains = textRelevance(p, { title: 'premium red rose bunch', searchText: '' });
  const descOnly = textRelevance(p, { title: 'seasonal bouquet', searchText: 'contains red rose stems' });
  const none = textRelevance(p, { title: 'ceramic planter', searchText: 'pot clay' });

  check('exact > prefix > contains > description-only > none',
    exact > prefix && prefix > contains && contains > descOnly && descOnly > none,
    [exact, prefix, contains, descOnly, none].join(' > '));
  eq('an empty query is neutral, not zero', textRelevance(parseQuery('', {}), { title: 'x' }), 0.5);
}

// ---------------------------------------------------------------------------
section('12. offline metrics');
// ---------------------------------------------------------------------------
{
  eq('a perfect ranking scores NDCG 1', ndcg([3, 2, 1, 0]), 1);
  check('a reversed ranking scores much lower', ndcg([0, 1, 2, 3]) < 0.6, String(ndcg([0, 1, 2, 3])));
  eq('no relevant results scores 0', ndcg([0, 0, 0]), 0);
  check('★ NDCG rewards putting the best result FIRST',
    ndcg([3, 0, 0, 0]) > ndcg([0, 0, 0, 3]));

  eq('MRR when the first hit is at position 1', mrr([2, 0, 0]), 1);
  eq('MRR when the first hit is at position 3', mrr([0, 0, 1]), Number((1 / 3).toFixed(6)));
  eq('MRR with no hits', mrr([0, 0, 0]), 0);

  eq('recall@k', recallAt([1, 0, 1, 0], 4, 4), 0.5);
  eq('dcg of nothing is 0', dcg([]), 0);
}

// ---------------------------------------------------------------------------
section('13. performance — ranking runs inside the request');
// ---------------------------------------------------------------------------
{
  const docs = Array.from({ length: 1000 }, (_, i) => doc({ _id: `p${i}`, soldCount30d: i * 7 % 3000 }));
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20; i += 1) rankDocuments(docs, { textScore: 0.7, now: NOW });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  check(`ranking 1 000 candidates takes ${ms.toFixed(2)}ms`, ms < 12, `${ms.toFixed(2)}ms is too slow`);
}

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(60)}`);
console.log(`search ranking: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log('✅ every ranking invariant holds\n');
