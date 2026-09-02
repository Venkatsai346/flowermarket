/**
 * queryUnderstanding.js — PURE query parsing for search (Phase 6.5 / S2).
 *
 * Turns what a person typed into what they meant, with no database and no
 * model: normalisation, synonyms, a small deterministic intent parser and
 * edit-distance typo correction against the store's own vocabulary.
 *
 * ── Why deterministic and not an LLM ────────────────────────────────────────
 * Search must be fast (a p95 budget in the tens of milliseconds), reproducible
 * (the same query must rank the same way twice), and debuggable ("why did it
 * do that?" needs an answer). A 60-line parser that handles "red roses under
 * 500" beats a model that handles everything unpredictably.
 *
 * ── Why this matters for an Indian flower market specifically ───────────────
 * Customers type `gulab`, `mogra`, `chameli`, `rajnigandha` as readily as
 * `rose`, `jasmine` and `tuberose`, and they transliterate inconsistently.
 * Synonyms are therefore DATA, editable by an operator who can see the
 * zero-result log — not a hardcoded list a developer has to redeploy.
 */

/** Words that carry no retrieval signal. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'and', 'or', 'with', 'in', 'on', 'to',
  'me', 'my', 'i', 'want', 'need', 'buy', 'get', 'some', 'please', 'show',
]);

/** Colour words worth turning into an attribute filter. */
const COLOURS = new Set([
  'red', 'white', 'pink', 'yellow', 'orange', 'purple', 'violet', 'blue',
  'green', 'peach', 'lavender', 'maroon', 'cream', 'mixed', 'multicolour', 'multicolor',
]);

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeQuery(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(raw) {
  return normalizeQuery(raw).split(' ').filter((t) => t && !STOP_WORDS.has(t));
}

/**
 * Price intent: "under 500", "below ₹999", "500-1000", "above 200".
 * Returns the filters found AND the query with those words removed, so the
 * price words do not then fail to match any product text.
 */
export function extractPriceIntent(raw) {
  let q = normalizeQuery(raw);
  const out = {};

  const range = q.match(/(\d+)\s*(?:-|to)\s*(\d+)/);
  if (range) {
    out.minPrice = Math.min(Number(range[1]), Number(range[2]));
    out.maxPrice = Math.max(Number(range[1]), Number(range[2]));
    q = q.replace(range[0], ' ');
  } else {
    const under = q.match(/(?:under|below|less than|upto|up to|within)\s*(?:rs\.?|inr)?\s*(\d+)/);
    if (under) { out.maxPrice = Number(under[1]); q = q.replace(under[0], ' '); }
    const over = q.match(/(?:above|over|more than|greater than)\s*(?:rs\.?|inr)?\s*(\d+)/);
    if (over) { out.minPrice = Number(over[1]); q = q.replace(over[0], ' '); }
  }

  return { filters: out, rest: q.replace(/\s+/g, ' ').trim() };
}

/** Colour intent, likewise removed from the text query once captured. */
export function extractColourIntent(raw) {
  const tokens = normalizeQuery(raw).split(' ');
  const found = tokens.filter((t) => COLOURS.has(t));
  if (!found.length) return { filters: {}, rest: normalizeQuery(raw) };
  return {
    filters: { colour: found[0] },
    rest: tokens.filter((t) => !COLOURS.has(t)).join(' ').trim(),
  };
}

/**
 * Expand a token through a synonym table.
 *
 * `groups` is [{ terms:[…], type:'equivalent'|'oneway', from?:string }].
 * An `equivalent` group expands in every direction (gulab ⇄ rose); a `oneway`
 * group expands only from its `from` term (a "bouquet" query should also find
 * "bunch", but not every "bunch" is a bouquet).
 */
export function expandSynonyms(tokens, groups = []) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const g of groups) {
      const terms = (g.terms || []).map((t) => String(t).toLowerCase());
      if (!terms.includes(token)) continue;
      if (g.type === 'oneway' && String(g.from || '').toLowerCase() !== token) continue;
      for (const t of terms) expanded.add(t);
    }
  }
  return [...expanded];
}

/**
 * Damerau-Levenshtein distance, capped for speed.
 *
 * Transpositions matter: `rsoe` for `rose` is one keystroke slip, and plain
 * Levenshtein charges it as two edits — which is enough to lose the match.
 */
export function editDistance(a, b, max = 3) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (Math.abs(s.length - t.length) > max) return max + 1;

  const prev2 = new Array(t.length + 1);
  let prev = new Array(t.length + 1);
  let cur = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1); // transposition
      }
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1; // early exit
    prev2.length = 0;
    prev2.push(...prev);
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[t.length];
}

/**
 * Correct a token against the store's OWN vocabulary.
 *
 * Correcting against a dictionary would "fix" real product names into English
 * words; correcting against the catalogue's own terms means the suggestion is
 * always something the store actually sells. Short tokens tolerate fewer edits,
 * because at 3 characters almost everything is 1 edit from everything.
 */
export function correctToken(token, vocabulary = [], { maxEdits = null } = {}) {
  const t = String(token).toLowerCase();
  if (!t || vocabulary.includes(t)) return { token: t, corrected: false };

  const budget = maxEdits ?? (t.length <= 2 ? 0 : t.length <= 5 ? 1 : 2);
  if (budget === 0) return { token: t, corrected: false };

  /**
   * At three characters, a SUBSTITUTION changes the word entirely — "pot"
   * would happily become "hot". A missing or doubled letter does not:
   * "rse" is unambiguously "rose". So very short tokens may only be corrected
   * by an insertion or deletion, never by a substitution.
   */
  const insertionsOnly = t.length <= 3;

  let best = null;
  let bestScore = Infinity;
  for (const word of vocabulary) {
    const lenDelta = Math.abs(word.length - t.length);
    if (lenDelta > budget) continue;
    if (insertionsOnly && lenDelta === 0) continue; // would be a substitution
    const d = editDistance(t, word, budget);
    if (d <= budget && d < bestScore) { best = word; bestScore = d; }
    if (bestScore === 1) break; // good enough; stop scanning
  }
  return best ? { token: best, corrected: true, from: t, distance: bestScore } : { token: t, corrected: false };
}

/**
 * The whole pipeline: raw string → structured query.
 *
 * @returns {{ raw, normalized, tokens, expanded, filters, corrections, isEmpty }}
 */
export function parseQuery(raw, { synonyms = [], vocabulary = [] } = {}) {
  const price = extractPriceIntent(raw);
  const colour = extractColourIntent(price.rest);
  const filters = { ...price.filters, ...colour.filters };

  /**
   * A colour is INFERRED intent, not an explicit filter — and the distinction
   * matters. Attribute data is sparse in real catalogues, but colour words are
   * reliably present in titles ("White Lily Bouquet"). So the colour is kept as
   * a search TERM (which biases ranking toward matching products) and merely
   * REPORTED as an inferred filter; only a colour the client passes explicitly
   * is allowed to constrain the result set.
   *
   * Found by the `white flowers` case in scripts/search-eval.mjs, which
   * returned red roses because the colour had been stripped from the text and
   * then hard-filtered against an attribute almost nothing carried.
   */
  const rawTokens = tokenize(colour.filters.colour ? `${colour.rest} ${colour.filters.colour}` : colour.rest);
  const corrections = [];
  const corrected = rawTokens.map((tk) => {
    const r = correctToken(tk, vocabulary);
    if (r.corrected) corrections.push({ from: r.from, to: r.token, distance: r.distance });
    return r.token;
  });

  const expanded = expandSynonyms(corrected, synonyms);

  const { colour: inferredColour, ...hardFilters } = filters;

  return {
    raw: String(raw || ''),
    normalized: normalizeQuery(raw),
    tokens: corrected,
    expanded,
    /** Only constraints that should NARROW the result set. */
    filters: hardFilters,
    /** Reported for the UI and analytics; biases ranking, never filters. */
    inferredColour: inferredColour || null,
    corrections,
    isEmpty: corrected.length === 0 && Object.keys(hardFilters).length === 0,
  };
}

/**
 * Progressive relaxation for a zero-result query.
 *
 * Returns the fallbacks to try IN ORDER. An empty results page is the worst
 * outcome in commerce — always better to show something adjacent and say so.
 */
export function relaxationPlan(parsed) {
  const plan = [];
  if (parsed.inferredColour) plan.push({ drop: 'colour', label: 'any colour' });
  if (parsed.filters.maxPrice || parsed.filters.minPrice) plan.push({ drop: 'price', label: 'any price' });
  if (parsed.tokens.length > 1) plan.push({ drop: 'lastToken', label: `just “${parsed.tokens[0]}”` });
  plan.push({ drop: 'all', label: 'popular items' });
  return plan;
}

/**
 * Text relevance in 0..1 for the Mongo provider.
 *
 * Mongo's `$meta:'textScore'` is unbounded and varies with corpus size, so it
 * cannot be blended with normalised signals directly. We compute our own:
 * exact-phrase and prefix matches on the TITLE dominate, because that is what
 * a shopper means when they type two words.
 */
export function textRelevance(parsed, doc) {
  const title = String(doc.title || '').toLowerCase();
  const text = String(doc.searchText || '').toLowerCase();
  const q = parsed.normalized;
  if (!q) return 0.5; // browse mode: everything is equally "relevant"

  if (title === q) return 1;
  if (title.startsWith(q)) return 0.95;
  if (title.includes(q)) return 0.85;

  const tokens = parsed.expanded.length ? parsed.expanded : parsed.tokens;
  if (!tokens.length) return 0.4;

  let titleHits = 0;
  let textHits = 0;
  for (const tk of tokens) {
    if (title.includes(tk)) titleHits += 1;
    else if (text.includes(tk)) textHits += 1;
  }
  const coverage = (titleHits + textHits * 0.45) / tokens.length;
  // a title hit is worth far more than a description hit
  return Math.min(0.8, coverage * (titleHits > 0 ? 0.8 : 0.5));
}

export default {
  normalizeQuery,
  tokenize,
  extractPriceIntent,
  extractColourIntent,
  expandSynonyms,
  editDistance,
  correctToken,
  parseQuery,
  relaxationPlan,
  textRelevance,
};
