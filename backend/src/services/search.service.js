import crypto from 'node:crypto';
import RankingProfile from '../models/rankingProfile.model.js';
import SearchSynonym from '../models/searchSynonym.model.js';
import SearchQueryLog from '../models/searchQueryLog.model.js';
import searchProvider from './searchProvider.service.js';
import config from '../config/index.js';
import { fromPaise } from '../utils/money.js';
import { serializeList } from '../utils/serialize.js';
import { parseQuery, relaxationPlan, textRelevance } from '../utils/queryUnderstanding.js';
import {
  rankDocuments, applyEditorial, bucketFor, DEFAULT_WEIGHTS, DEFAULT_TUNING,
} from '../utils/ranking.js';

/**
 * SearchService — query understanding + ranking + measurement (Phase 6.5).
 *
 * The flow, and why it is in this order:
 *   1. PARSE     "red gulab bouqet under 800" → filters + corrected, expanded tokens
 *   2. RESOLVE   which ranking profile applies (tenant override, A/B bucket)
 *   3. RETRIEVE  a bounded candidate set from the provider
 *   4. RANK      in-process with the pure scorer, then apply editorial pins
 *   5. RELAX     if nothing matched, progressively drop constraints rather
 *                than showing an empty page
 *   6. LOG       sampled, PII-free, so the change can be measured tomorrow
 *
 * Step 6 is not optional. A ranking system without a query log is a ranking
 * system nobody can ever prove was improved.
 */

const CACHE_TTL_MS = 60000;

class SearchService {
  constructor() {
    this.profileCache = new Map(); // tenantId → { at, profiles }
    this.synonymCache = new Map();
    this.vocabCache = new Map();
  }

  // -------------------------------------------------------------------------
  // configuration
  // -------------------------------------------------------------------------

  async loadProfiles(tenantId) {
    const key = String(tenantId || 'platform');
    const hit = this.profileCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.profiles;
    const profiles = await RankingProfile.find({
      isActive: true,
      $or: [{ tenantId: null }, { tenantId }],
    }).lean();
    this.profileCache.set(key, { at: Date.now(), profiles });
    return profiles;
  }

  async loadSynonyms(tenantId) {
    const key = String(tenantId || 'platform');
    const hit = this.synonymCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.groups;
    const rows = await SearchSynonym.find({
      isActive: true,
      $or: [{ tenantId: null }, { tenantId }],
    }).lean();
    const groups = rows.map((r) => ({ terms: r.terms, type: r.type, from: r.from }));
    this.synonymCache.set(key, { at: Date.now(), groups });
    return groups;
  }

  async loadVocabulary(tenantId) {
    const key = String(tenantId);
    const hit = this.vocabCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS * 5) return hit.words;
    const words = await searchProvider.vocabulary({ tenantId });
    this.vocabCache.set(key, { at: Date.now(), words });
    return words;
  }

  invalidate(tenantId = null) {
    if (tenantId) {
      const k = String(tenantId);
      this.profileCache.delete(k);
      this.synonymCache.delete(k);
      this.vocabCache.delete(k);
    } else {
      this.profileCache.clear();
      this.synonymCache.clear();
      this.vocabCache.clear();
    }
  }

  /**
   * Pick the profile for THIS visitor.
   *
   * An experiment profile (`trafficPct > 0`) claims a deterministic slice of
   * sessions; everyone else gets the tenant default, then the platform
   * default, then the built-in weights. The chosen bucket is logged with the
   * query so the two arms can be compared later.
   */
  async resolveProfile({ tenantId, sessionKey }) {
    const profiles = await this.loadProfiles(tenantId);
    const scoped = profiles.filter((p) => String(p.tenantId || '') === String(tenantId || ''));
    const platform = profiles.filter((p) => !p.tenantId);

    const experiment = [...scoped, ...platform].find((p) => p.trafficPct > 0 && bucketFor(sessionKey, p.trafficPct));
    const chosen = experiment
      || scoped.find((p) => p.isDefault)
      || platform.find((p) => p.isDefault)
      || null;

    return {
      code: chosen?.code || 'built-in',
      bucket: experiment ? 'variant' : 'control',
      weights: { ...DEFAULT_WEIGHTS, ...(chosen?.weights || {}) },
      tuning: { ...DEFAULT_TUNING, ...(chosen?.tuning || {}) },
      pins: chosen?.pins || [],
      buries: chosen?.buries || [],
    };
  }

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------

  /**
   * @returns {{ items, meta, query, facets, profile }}
   * The `items` shape is intentionally identical to the legacy `/catalog`
   * response, plus additive fields — the storefront and mobile client keep
   * working without a change.
   */
  async search({ tenantId, query = {}, sessionKey = null, log = true }) {
    const started = process.hrtime.bigint();
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(60, Math.max(1, Number(query.limit) || 24));

    const [synonyms, vocabulary, profile] = await Promise.all([
      this.loadSynonyms(tenantId),
      query.search ? this.loadVocabulary(tenantId) : Promise.resolve([]),
      this.resolveProfile({ tenantId, sessionKey }),
    ]);

    const parsed = parseQuery(query.search || '', { synonyms, vocabulary });

    // explicit filters win over anything inferred from the text
    const filters = {
      ...parsed.filters,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.minPrice != null ? { minPrice: Number(query.minPrice) } : {}),
      ...(query.maxPrice != null ? { maxPrice: Number(query.maxPrice) } : {}),
      ...(query.inStock ? { inStock: true } : {}),
      // an EXPLICIT colour from the client constrains; an inferred one does not
      ...(query.colour ? { colour: query.colour } : {}),
    };

    let candidates = await searchProvider.retrieve({ tenantId, parsed, filters });
    let relaxedTo = null;

    // ---- zero-result recovery: never show an empty page ----
    if (!candidates.length && (parsed.tokens.length || Object.keys(filters).length)) {
      for (const step of relaxationPlan(parsed)) {
        const relaxed = { ...filters };
        let p = parsed;
        if (step.drop === 'colour') {
          // the colour is a token, not a filter — relax by dropping the word
          const c = parsed.inferredColour;
          p = { ...parsed, tokens: parsed.tokens.filter((t) => t !== c), expanded: parsed.expanded.filter((t) => t !== c) };
        }
        else if (step.drop === 'price') { delete relaxed.minPrice; delete relaxed.maxPrice; }
        else if (step.drop === 'lastToken') p = { ...parsed, tokens: parsed.tokens.slice(0, 1), expanded: parsed.expanded.slice(0, 1) };
        else { p = { ...parsed, tokens: [], expanded: [] }; }

        // eslint-disable-next-line no-await-in-loop
        candidates = await searchProvider.retrieve({ tenantId, parsed: p, filters: relaxed });
        if (candidates.length) { relaxedTo = step.label; break; }
      }
    }

    // ---- rank ----
    const textScores = new Map(
      candidates.map((d) => [String(d._id), textRelevance(parsed, d)])
    );
    let ranked = rankDocuments(candidates, {
      weights: profile.weights,
      tuning: profile.tuning,
      textScores,
    });

    const pinsForQuery = (profile.pins || [])
      .filter((p) => !p.query || p.query.toLowerCase() === parsed.normalized)
      .flatMap((p) => p.listingIds || []);
    ranked = applyEditorial(ranked, { pins: pinsForQuery, buries: profile.buries });

    const total = ranked.length;
    const slice = ranked.slice((page - 1) * limit, page * limit);

    const items = slice.map((r) => this.present(r, query.explain === 'true' || query.explain === true));
    const facets = await searchProvider.facets({ tenantId, parsed, filters });

    const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
    const queryId = crypto.randomUUID();

    if (log) {
      this.logQuery({
        tenantId, sessionKey, queryId, parsed, filters, profile,
        resultCount: total, relaxedTo, latencyMs,
        topListingIds: items.slice(0, 10).map((i) => i.listingId),
      }).catch(() => {});
    }

    return {
      items,
      meta: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
        queryId,
        latencyMs: Number(latencyMs.toFixed(1)),
      },
      query: {
        raw: parsed.raw,
        normalized: parsed.normalized,
        corrections: parsed.corrections,
        appliedFilters: filters,
        relaxedTo,
        inferredColour: parsed.inferredColour,
      },
      facets,
      profile: { code: profile.code, bucket: profile.bucket },
    };
  }

  /** Shape a ranked row like the legacy catalogue row, plus additive fields. */
  present(r, explain = false) {
    const d = r.doc;
    return {
      listingId: String(d.listingId),
      price: { sellingPrice: fromPaise(d.pricePaise), mrp: d.mrpPaise ? fromPaise(d.mrpPaise) : null, currency: 'INR' },
      stockQty: d.stockQty,
      availability: { status: d.inStock ? 'in_stock' : 'out_of_stock' },
      product: {
        id: String(d.masterId),
        title: d.title,
        categoryId: d.categoryId ? String(d.categoryId) : null,
        brandName: d.brandName,
        defaultSellingUnit: d.unit,
        imageUrl: d.imageUrl,
        isPerishable: d.isPerishable,
        soldCount: d.soldCount30d,
      },
      promoted: r.promoted || undefined,
      // `explain` is what makes the admin tuner honest: "why is this third?"
      ...(explain ? { _score: r.score, _components: r.components } : {}),
    };
  }

  async suggest({ tenantId, prefix }) {
    return searchProvider.suggest({ tenantId, prefix });
  }

  // -------------------------------------------------------------------------
  // measurement
  // -------------------------------------------------------------------------

  /** PII-free, sampled. The session is hashed, never stored raw. */
  async logQuery({ tenantId, sessionKey, queryId, parsed, filters, profile, resultCount, relaxedTo, latencyMs, topListingIds }) {
    if (Math.random() * 100 > config.search.logSamplePct) return null;
    return SearchQueryLog.create({
      tenantId,
      sessionHash: sessionKey
        ? crypto.createHash('sha256').update(String(sessionKey)).digest('hex').slice(0, 16)
        : null,
      queryId,
      query: parsed.raw.slice(0, 200),
      normalizedQuery: parsed.normalized.slice(0, 200),
      corrections: parsed.corrections,
      filters,
      profileCode: profile.code,
      experimentBucket: profile.bucket,
      resultCount,
      zeroResult: resultCount === 0,
      relaxedTo,
      latencyMs: Math.round(latencyMs),
      topListingIds,
    });
  }

  /** Click / add-to-cart beacons from the storefront. */
  async recordEvent({ queryId, type, position = null, listingId = null }) {
    if (!queryId) return { recorded: false };
    const update = {};
    if (type === 'click' && position != null) update.$addToSet = { clickedPositions: Number(position) };
    else if (type === 'add_to_cart' && listingId) update.$addToSet = { addedToCart: String(listingId) };
    else if (type === 'order' && listingId) update.$addToSet = { orderedListingIds: String(listingId) };
    else return { recorded: false };

    const res = await SearchQueryLog.updateOne({ queryId }, update);
    return { recorded: res.modifiedCount > 0 };
  }

  /**
   * Operational search analytics: what people look for, what they never find,
   * and how the two experiment arms compare.
   */
  async analytics({ tenantId, from = null, to = null }) {
    const match = { tenantId };
    if (from || to) {
      match.at = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      };
    }

    const [top, zero, buckets, latency] = await Promise.all([
      SearchQueryLog.aggregate([
        { $match: { ...match, normalizedQuery: { $ne: '' } } },
        { $group: { _id: '$normalizedQuery', searches: { $sum: 1 }, clicks: { $sum: { $size: '$clickedPositions' } }, carts: { $sum: { $size: '$addedToCart' } } } },
        { $sort: { searches: -1 } },
        { $limit: 20 },
      ]),
      SearchQueryLog.aggregate([
        { $match: { ...match, zeroResult: true } },
        { $group: { _id: '$normalizedQuery', searches: { $sum: 1 } } },
        { $sort: { searches: -1 } },
        { $limit: 20 },
      ]),
      SearchQueryLog.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$experimentBucket',
            searches: { $sum: 1 },
            clicked: { $sum: { $cond: [{ $gt: [{ $size: '$clickedPositions' }, 0] }, 1, 0] } },
            carted: { $sum: { $cond: [{ $gt: [{ $size: '$addedToCart' }, 0] }, 1, 0] } },
            zero: { $sum: { $cond: ['$zeroResult', 1, 0] } },
          },
        },
      ]),
      SearchQueryLog.aggregate([
        { $match: match },
        { $group: { _id: null, avg: { $avg: '$latencyMs' }, max: { $max: '$latencyMs' } } },
      ]),
    ]);

    return {
      topQueries: top.map((t) => ({
        query: t._id, searches: t.searches, clicks: t.clicks, carts: t.carts,
        ctr: t.searches ? Number((t.clicks / t.searches).toFixed(3)) : 0,
      })),
      zeroResultQueries: zero.map((z) => ({ query: z._id, searches: z.searches })),
      experiments: buckets.map((b) => ({
        bucket: b._id,
        searches: b.searches,
        clickThroughRate: b.searches ? Number((b.clicked / b.searches).toFixed(3)) : 0,
        addToCartRate: b.searches ? Number((b.carted / b.searches).toFixed(3)) : 0,
        zeroResultRate: b.searches ? Number((b.zero / b.searches).toFixed(3)) : 0,
      })),
      latency: { avgMs: Math.round(latency[0]?.avg || 0), maxMs: latency[0]?.max || 0 },
    };
  }

  // -------------------------------------------------------------------------
  // admin
  // -------------------------------------------------------------------------

  async listProfiles({ tenantId }) {
    const rows = await RankingProfile.find({ $or: [{ tenantId: null }, { tenantId }] }).sort({ tenantId: 1, code: 1 }).lean();
    return { items: serializeList(rows), defaults: { weights: DEFAULT_WEIGHTS, tuning: DEFAULT_TUNING } };
  }

  async upsertProfile({ tenantId, payload }) {
    const doc = await RankingProfile.findOneAndUpdate(
      { tenantId, code: payload.code },
      { $set: { ...payload, tenantId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    this.invalidate(tenantId);
    return doc;
  }

  async listSynonyms({ tenantId }) {
    return { items: serializeList(await SearchSynonym.find({ $or: [{ tenantId: null }, { tenantId }] }).lean()) };
  }

  async createSynonym({ tenantId, payload }) {
    const doc = await SearchSynonym.create({ ...payload, tenantId });
    this.invalidate(tenantId);
    return doc;
  }

  /** Seed the vocabulary this market actually types. */
  async seedSynonyms() {
    const existing = await SearchSynonym.countDocuments({});
    if (existing > 0) return { seeded: 0, skipped: true };
    const groups = [
      ['gulab', 'rose', 'roses'],
      ['mogra', 'jasmine', 'chameli', 'jasmin'],
      ['rajnigandha', 'tuberose'],
      ['genda', 'marigold', 'gainda'],
      ['kamal', 'lotus'],
      ['guldaudi', 'chrysanthemum', 'chrysanth'],
      ['bouquet', 'bunch', 'guldasta'],
      ['gamla', 'pot', 'planter'],
      ['paudha', 'plant', 'sapling'],
      ['mala', 'garland', 'haar'],
    ];
    await SearchSynonym.insertMany(groups.map((terms) => ({
      terms, type: 'equivalent', tenantId: null, isActive: true,
      note: 'Seeded vocabulary — extend from the zero-result log',
    })));
    return { seeded: groups.length, skipped: false };
  }
}

export default new SearchService();
