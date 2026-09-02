/**
 * search-eval.mjs — offline relevance evaluation (Phase 6.5 / S3).
 *
 *   node scripts/search-eval.mjs
 *   node scripts/search-eval.mjs --baseline    (score the legacy regex order)
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Ranking changes feel better to whoever made them. The only defence is a
 * fixed judgment set — queries paired with hand-graded results — and a metric
 * computed the same way every time. NDCG@10 is the gate: a tuning change that
 * lowers it does not ship, however good the demo looked.
 *
 * The judgment set below is deliberately small and readable. It is meant to be
 * extended from the ZERO-RESULT LOG (`GET /search/analytics`), which is where
 * real relevance bugs announce themselves.
 *
 * Runs with no database: the corpus is a fixture, so the gate is executable in
 * CI on every commit.
 */

import {
  rankDocuments, ndcg, mrr, recallAt,
} from '../src/utils/ranking.js';
import { parseQuery, textRelevance } from '../src/utils/queryUnderstanding.js';

const HOUR = 3600000;
const NOW = Date.now();

/** A small but representative catalogue. */
const CORPUS = [
  { _id: 'p1', title: 'Red Rose Bunch (20 stems)', searchText: 'red rose bunch fresh cut flowers roses', tags: ['rose', 'red'], stockQty: 24, soldCount30d: 1240, clicks30d: 300, impressions30d: 3000, pricePaise: 54900, mrpPaise: 69900, listedAt: NOW - 12 * HOUR, vendorRating: 4.5, attributes: { colour: 'red' } },
  { _id: 'p2', title: 'Pink Rose Bouquet', searchText: 'pink rose bouquet hand tied roses', tags: ['rose', 'pink', 'bouquet'], stockQty: 10, soldCount30d: 420, clicks30d: 90, impressions30d: 1200, pricePaise: 79900, mrpPaise: 89900, listedAt: NOW - 30 * HOUR, vendorRating: 4.2, attributes: { colour: 'pink' } },
  { _id: 'p3', title: 'White Lily Bouquet', searchText: 'white lily bouquet oriental lilies', tags: ['lily', 'white', 'bouquet'], stockQty: 8, soldCount30d: 430, clicks30d: 80, impressions30d: 1000, pricePaise: 89900, mrpPaise: 109900, listedAt: NOW - 20 * HOUR, vendorRating: 4.6, attributes: { colour: 'white' } },
  { _id: 'p4', title: 'Marigold Garland 5ft', searchText: 'marigold garland genda temple mala', tags: ['marigold', 'garland'], stockQty: 60, soldCount30d: 3100, clicks30d: 500, impressions30d: 6000, pricePaise: 19900, mrpPaise: 0, listedAt: NOW - 6 * HOUR, vendorRating: 4.0 },
  { _id: 'p5', title: 'Jasmine Strand (Mogra)', searchText: 'jasmine mogra chameli strand fragrant', tags: ['jasmine', 'mogra'], stockQty: 3, soldCount30d: 2200, clicks30d: 400, impressions30d: 5000, pricePaise: 14900, mrpPaise: 17900, listedAt: NOW - 3 * HOUR, vendorRating: 4.3 },
  { _id: 'p6', title: 'Peace Lily in Ceramic Pot', searchText: 'peace lily plant ceramic pot indoor gamla', tags: ['plant', 'lily', 'pot'], stockQty: 12, soldCount30d: 190, clicks30d: 40, impressions30d: 800, pricePaise: 124900, mrpPaise: 149900, listedAt: NOW - 200 * HOUR, vendorRating: 4.1 },
  { _id: 'p7', title: 'Red Rose Petals 500g', searchText: 'red rose petals decor ritual', tags: ['rose', 'petals', 'red'], stockQty: 40, soldCount30d: 1500, clicks30d: 200, impressions30d: 2500, pricePaise: 24900, mrpPaise: 0, listedAt: NOW - 8 * HOUR, vendorRating: 4.4, attributes: { colour: 'red' } },
  { _id: 'p8', title: 'Mixed Gerbera Box', searchText: 'gerbera mixed box gift twelve stems', tags: ['gerbera', 'gift'], stockQty: 0, soldCount30d: 610, clicks30d: 120, impressions30d: 1500, pricePaise: 74900, mrpPaise: 89900, listedAt: NOW - 40 * HOUR, vendorRating: 4.0 },
  { _id: 'p9', title: 'Golden Money Plant', searchText: 'money plant golden pothos indoor paudha', tags: ['plant'], stockQty: 30, soldCount30d: 880, clicks30d: 150, impressions30d: 2000, pricePaise: 39900, mrpPaise: 54900, listedAt: NOW - 500 * HOUR, vendorRating: 3.8 },
  { _id: 'p10', title: 'Tuberose Rajnigandha Bunch', searchText: 'tuberose rajnigandha fragrant white stems', tags: ['tuberose'], stockQty: 18, soldCount30d: 540, clicks30d: 70, impressions30d: 900, pricePaise: 32900, mrpPaise: 0, listedAt: NOW - 10 * HOUR, vendorRating: 4.2 },
];

const SYNONYMS = [
  { terms: ['gulab', 'rose', 'roses'], type: 'equivalent' },
  { terms: ['mogra', 'jasmine', 'chameli'], type: 'equivalent' },
  { terms: ['rajnigandha', 'tuberose'], type: 'equivalent' },
  { terms: ['genda', 'marigold'], type: 'equivalent' },
  { terms: ['gamla', 'pot', 'planter'], type: 'equivalent' },
];

const VOCAB = [...new Set(CORPUS.flatMap((d) => `${d.title} ${d.searchText}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)))].filter((w) => w.length > 2);

/**
 * The judgment set: query → { listingId: grade }, graded 0–3.
 *   3 = exactly what they asked for
 *   2 = a good alternative
 *   1 = loosely related
 *   0 = irrelevant (omitted)
 */
const JUDGMENTS = [
  { query: 'red rose', grades: { p1: 3, p7: 2, p2: 1 } },
  { query: 'gulab', grades: { p1: 3, p2: 3, p7: 2 } },
  { query: 'mogra', grades: { p5: 3 } },
  { query: 'rajnigandha', grades: { p10: 3 } },
  { query: 'bouquet', grades: { p2: 3, p3: 3, p8: 2 } },
  { query: 'lily', grades: { p3: 3, p6: 2 } },
  { query: 'plant', grades: { p9: 3, p6: 3 } },
  { query: 'garland', grades: { p4: 3 } },
  { query: 'rse', grades: { p1: 3, p2: 2, p7: 2 } },          // typo
  { query: 'red roses under 300', grades: { p7: 3 } },        // price intent
  { query: 'white flowers', grades: { p3: 3, p10: 2 } },
  { query: 'gift box', grades: { p8: 3 } },
];

const useBaseline = process.argv.includes('--baseline');

/** The pre-6.5 behaviour: substring match, then alphabetical by searchText. */
function baselineRank(queryText) {
  const q = queryText.toLowerCase();
  return CORPUS
    .filter((d) => `${d.title} ${d.searchText}`.toLowerCase().includes(q))
    .sort((a, b) => a.searchText.localeCompare(b.searchText))
    .map((d) => ({ doc: d }));
}

function rankedFor(queryText) {
  const parsed = parseQuery(queryText, { synonyms: SYNONYMS, vocabulary: VOCAB });
  const terms = parsed.expanded.length ? parsed.expanded : parsed.tokens;

  let candidates = CORPUS;
  if (terms.length) {
    const rx = new RegExp(terms.join('|'), 'i');
    candidates = CORPUS.filter((d) => rx.test(`${d.title} ${d.searchText} ${(d.tags || []).join(' ')}`));
  }
  if (parsed.filters.maxPrice != null) {
    const filtered = candidates.filter((d) => d.pricePaise <= parsed.filters.maxPrice * 100);
    if (filtered.length) candidates = filtered;
  }

  const textScores = new Map(candidates.map((d) => [String(d._id), textRelevance(parsed, d)]));
  return rankDocuments(candidates, { textScores, now: NOW });
}

console.log(`\n🔍 Search relevance evaluation — ${useBaseline ? 'BASELINE (legacy regex + alphabetical)' : 'RANKED (Phase 6.5)'}\n`);
console.log('query'.padEnd(24), 'NDCG@10'.padStart(8), 'MRR'.padStart(6), 'R@50'.padStart(6), '  top result');
console.log('─'.repeat(96));

let sumNdcg = 0;
let sumMrr = 0;
let sumRecall = 0;

for (const j of JUDGMENTS) {
  const ranked = useBaseline ? baselineRank(j.query) : rankedFor(j.query);
  const grades = ranked.map((r) => j.grades[String(r.doc._id)] || 0);
  const totalRelevant = Object.keys(j.grades).length;

  const n = ndcg(grades, 10);
  const m = mrr(grades);
  const rc = recallAt(grades, totalRelevant, 50);
  sumNdcg += n;
  sumMrr += m;
  sumRecall += rc;

  const top = ranked[0]?.doc?.title || '—';
  const flag = n >= 0.9 ? '✅' : n >= 0.6 ? '🟡' : '❌';
  console.log(
    j.query.padEnd(24),
    n.toFixed(3).padStart(8),
    m.toFixed(2).padStart(6),
    rc.toFixed(2).padStart(6),
    ` ${flag} ${top.slice(0, 42)}`
  );
}

const n = JUDGMENTS.length;
const avgNdcg = sumNdcg / n;
console.log('─'.repeat(96));
console.log(
  'MEAN'.padEnd(24),
  avgNdcg.toFixed(3).padStart(8),
  (sumMrr / n).toFixed(2).padStart(6),
  (sumRecall / n).toFixed(2).padStart(6)
);

/**
 * THE GATE. The measured baseline is 0.62; the plan committed to ≥ +15%,
 * i.e. 0.713. The threshold is deliberately just above what we achieved, so
 * a future tuning change that quietly regresses relevance fails CI.
 */
const GATE = Number(process.env.SEARCH_NDCG_GATE || 0.85);
if (!useBaseline) {
  console.log(`\ngate: NDCG@10 ≥ ${GATE}`);
  if (avgNdcg < GATE) {
    console.log(`❌ RELEVANCE REGRESSION — ${avgNdcg.toFixed(3)} is below the gate. This change must not ship.\n`);
    process.exit(1);
  }
  console.log(`✅ relevance holds (${avgNdcg.toFixed(3)})\n`);
}
