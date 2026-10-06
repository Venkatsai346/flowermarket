import crypto from 'node:crypto';
import RankingProfile from '../models/rankingProfile.model.js';
import SearchSynonym from '../models/searchSynonym.model.js';
import SearchQueryLog from '../models/searchQueryLog.model.js';
import SearchDocument from '../models/searchDocument.model.js';
import searchProvider from './searchProvider.service.js';
import searchAnalyticsService from './searchAnalytics.service.js';
import searchMerchandisingService from './searchMerchandising.service.js';
import config from '../config/index.js';
import { fromPaise } from '../utils/money.js';
import { BoundedCache } from '../utils/BoundedCache.js';
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
    // Phase 7.4: bounded LRU caches (max 200 entries, 60s TTL).
    // The previous unbounded Maps grew without limit in long-running
    // processes, eventually causing OOM. Each cache now caps at 200
    // entries (~200 tenants) and evicts LRU when full.
    this.profileCache = new BoundedCache({ maxEntries: 200, ttlMs: CACHE_TTL_MS, name: 'search:profiles' });
    this.synonymCache = new BoundedCache({ maxEntries: 200, ttlMs: CACHE_TTL_MS, name: 'search:synonyms' });
    this.vocabCache = new BoundedCache({ maxEntries: 100, ttlMs: CACHE_TTL_MS * 5, name: 'search:vocab' });
  }

  // -------------------------------------------------------------------------
  // configuration
  // -------------------------------------------------------------------------

  async loadProfiles(tenantId) {
    const key = String(tenantId || 'platform');
    const hit = this.profileCache.get(key);
    if (hit) return hit;
    const profiles = await RankingProfile.find({
      isActive: true,
      $or: [{ tenantId: null }, { tenantId }],
    }).lean();
    this.profileCache.set(key, profiles);
    return profiles;
  }

  async loadSynonyms(tenantId) {
    const key = String(tenantId || 'platform');
    const hit = this.synonymCache.get(key);
    if (hit) return hit;
    const rows = await SearchSynonym.find({
      isActive: true,
      $or: [{ tenantId: null }, { tenantId }],
    }).lean();
    const groups = rows.map((r) => ({ terms: r.terms, type: r.type, from: r.from }));
    this.synonymCache.set(key, groups);
    return groups;
  }

  async loadVocabulary(tenantId) {
    const key = String(tenantId);
    const hit = this.vocabCache.get(key);
    if (hit) return hit;
    const words = await searchProvider.vocabulary({ tenantId });
    this.vocabCache.set(key, words);
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
  async search({ tenantId, query = {}, sessionKey = null, log = true, masterCandidates = false }) {
    const started = process.hrtime.bigint();
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(60, Math.max(1, Number(query.limit) || 24));

    const [synonyms, vocabulary, profile] = await Promise.all([
      this.loadSynonyms(tenantId),
      query.search ? this.loadVocabulary(tenantId) : Promise.resolve([]),
      this.resolveProfile({ tenantId, sessionKey }),
    ]);

    const parsed = parseQuery(query.search || '', { synonyms, vocabulary });
    const merchandising = await searchMerchandisingService.resolve({
      tenantId, normalizedQuery: parsed.normalized, categoryId: query.categoryId || null,
    });

    // explicit filters win over anything inferred from the text
    const filters = {
      ...parsed.filters,
      ...(query.categoryIds?.length ? { categoryIds: query.categoryIds } : query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.type ? { productType: query.type } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.minPrice != null ? { minPrice: Number(query.minPrice) } : {}),
      ...(query.maxPrice != null ? { maxPrice: Number(query.maxPrice) } : {}),
      ...(query.inStock ? { inStock: true } : {}),
      // an EXPLICIT colour from the client constrains; an inferred one does not
      ...(query.colour ? { colour: query.colour } : {}),
      ...(query.attributes && Object.keys(query.attributes).length ? { attributes: query.attributes } : {}),
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

    // Replace unavailable campaign targets with the first configured in-stock
    // alternative. Targets are fetched from canonical Mongo so the rule works
    // even when the substitute did not text-match the original query.
    for (const substitution of merchandising.substitutions) {
      const unavailable = ranked.find((row) => !row.doc.inStock && substitution.from.includes(String(row.doc.listingId)));
      if (!unavailable || !substitution.to.length) continue;
      // Rules are bounded to 20 substitutes; one indexed read per matching rule is predictable.
      // eslint-disable-next-line no-await-in-loop
      const replacement = await SearchDocument.findOne({
        tenantId, listingId: { $in: substitution.to }, inStock: true, status: 'active',
      }).lean();
      if (!replacement || ranked.some((row) => String(row.doc.listingId) === String(replacement.listingId))) continue;
      const [replacementRank] = rankDocuments([replacement], {
        weights: profile.weights, tuning: profile.tuning,
        textScores: new Map([[String(replacement._id), textRelevance(parsed, replacement)]]),
      });
      ranked = ranked.filter((row) => row !== unavailable);
      ranked.push({ ...replacementRank, score: unavailable.score, substitutedFor: String(unavailable.doc.listingId) });
      ranked.sort((a, b) => b.score - a.score || String(a.doc._id).localeCompare(String(b.doc._id)));
    }

    if (merchandising.boosts.size) {
      ranked = ranked.map((row) => {
        const editorialBoost = merchandising.boosts.get(String(row.doc.listingId)) || 0;
        return editorialBoost ? { ...row, score: row.score + editorialBoost, promoted: true } : row;
      }).sort((a, b) => b.score - a.score || String(a.doc._id).localeCompare(String(b.doc._id)));
    }
    const pinsForQuery = [
      ...(profile.pins || [])
        .filter((p) => !p.query || p.query.toLowerCase() === parsed.normalized)
        .flatMap((p) => p.listingIds || []),
      ...merchandising.pins,
    ];
    ranked = applyEditorial(ranked, {
      pins: pinsForQuery,
      buries: [...(profile.buries || []), ...merchandising.buries],
    });

    // Explicit customer sorts must be deterministic and must not silently
    // continue using relevance ranking. Editorial pinning applies to the
    // default relevance view only; price/newest/popularity mean exactly what
    // their labels promise.
    if (query.sort === 'price_asc') {
      ranked.sort((a, b) => (a.doc.pricePaise - b.doc.pricePaise) || String(a.doc._id).localeCompare(String(b.doc._id)));
    } else if (query.sort === 'price_desc') {
      ranked.sort((a, b) => (b.doc.pricePaise - a.doc.pricePaise) || String(a.doc._id).localeCompare(String(b.doc._id)));
    } else if (query.sort === 'newest') {
      ranked.sort((a, b) => new Date(b.doc.listedAt || 0) - new Date(a.doc.listedAt || 0));
    } else if (query.sort === 'popularity') {
      ranked.sort((a, b) => (b.doc.soldCount30d || 0) - (a.doc.soldCount30d || 0));
    }

    // Family PLPs need the ranker's ordered master identities, not a page of
    // listing rows. Returning this bounded internal projection lets the
    // authoritative catalog read model perform exact master-level facets,
    // visibility checks and cursor pagination without giving up typo recovery,
    // synonyms, experiments or editorial ranking.
    if (masterCandidates) {
      const seen = new Set();
      const masterIds = [];
      for (const row of ranked) {
        const id = String(row.doc.masterId || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        masterIds.push(id);
      }
      const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
      const queryId = crypto.randomUUID();
      if (log) {
        await this.logQuery({
          tenantId, sessionKey, queryId, parsed, filters, profile,
          resultCount: masterIds.length, relaxedTo, latencyMs,
          topListingIds: ranked.slice(0, 1000).map((row) => String(row.doc.listingId)),
          topMasterIds: ranked.slice(0, 1000).map((row) => String(row.doc.masterId)),
        }).catch(() => {});
      }
      return {
        masterIds,
        meta: {
          total: masterIds.length, queryId, latencyMs: Number(latencyMs.toFixed(1)),
          redirect: merchandising.redirect,
          substitutions: merchandising.substitutions,
          shelves: merchandising.shelves,
          appliedMerchandisingRules: merchandising.appliedRuleCodes,
        },
        query: {
          raw: parsed.raw,
          normalized: parsed.normalized,
          corrections: parsed.corrections,
          appliedFilters: filters,
          relaxedTo,
          inferredColour: parsed.inferredColour,
        },
        profile: { code: profile.code, bucket: profile.bucket },
      };
    }

    const total = ranked.length;
    const slice = ranked.slice((page - 1) * limit, page * limit);

    const items = slice.map((r) => this.present(r, query.explain === 'true' || query.explain === true));
    const facets = await searchProvider.facets({ tenantId, parsed, filters });

    const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
    const queryId = crypto.randomUUID();

    if (log) {
      await this.logQuery({
        tenantId, sessionKey, queryId, parsed, filters, profile,
        resultCount: total, relaxedTo, latencyMs,
        topListingIds: ranked.slice(0, 1000).map((row) => String(row.doc.listingId)),
        topMasterIds: ranked.slice(0, 1000).map((row) => String(row.doc.masterId)),
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
        redirect: merchandising.redirect,
        substitutions: merchandising.substitutions,
        shelves: merchandising.shelves,
        appliedMerchandisingRules: merchandising.appliedRuleCodes,
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
      variantId: d.variantId ? String(d.variantId) : null,
      price: { sellingPrice: fromPaise(d.pricePaise), mrp: d.mrpPaise ? fromPaise(d.mrpPaise) : null, currency: 'INR' },
      stockQty: d.stockQty,
      availability: { status: d.inStock ? 'in_stock' : 'out_of_stock' },
      variant: d.variantId ? {
        id: String(d.variantId),
        label: d.variantLabel || null,
        value: d.variantLabel || null,
        variantType: d.variantType || null,
        optionValues: d.optionValues || [],
      } : null,
      product: {
        id: String(d.masterId),
        title: d.title,
        slug: d.slug || null,
        categoryId: d.categoryId ? String(d.categoryId) : null,
        brandName: d.brandName,
        defaultSellingUnit: d.unit,
        kind: d.productKind || 'physical',
        unitPolicy: d.unitPolicy || null,
        packageCodes: d.packageCodes || [],
        complianceCodes: d.complianceCodes || [],
        variantAttributes: d.variantAttributes || [],
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
  async logQuery({ tenantId, sessionKey, queryId, parsed, filters, profile, resultCount, relaxedTo, latencyMs, topListingIds, topMasterIds }) {
    await searchAnalyticsService.recordQuery({
      tenantId, sessionKey, queryId, normalizedQuery: parsed.normalized,
      profileCode: profile.code, experimentBucket: profile.bucket,
      resultCount, latencyMs, candidateListingIds: topListingIds, candidateMasterIds: topMasterIds,
    });
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
  async recordEvent({ tenantId, sessionKey, queryId, eventId, type, position = null, listingId = null }) {
    return searchAnalyticsService.recordEvent({
      tenantId, sessionKey, queryId, eventId, type, position, listingId,
    });
  }

  /**
   * Operational search analytics: what people look for, what they never find,
   * and how the two experiment arms compare.
   */
  async analytics({ tenantId, from = null, to = null }) {
    return searchAnalyticsService.analytics({ tenantId, from, to });
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
