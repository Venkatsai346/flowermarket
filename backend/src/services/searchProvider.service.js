import mongoose from 'mongoose';
import SearchDocument from '../models/searchDocument.model.js';
import config from '../config/index.js';
import { textRelevance } from '../utils/queryUnderstanding.js';

/**
 * SearchProvider — the retrieval abstraction (Phase 6.5 / S1).
 *
 * Same discipline as payments, notifications, storage, e-invoicing and payouts:
 * the rest of the codebase calls `index()` / `search()` / `suggest()` /
 * `remove()` / `health()` and never learns which engine is behind it.
 *
 *   mongo      (default) — `$text` retrieval + our own scoring pass. Zero new
 *                          infrastructure, which matters: a search engine you
 *                          have to operate before you have traffic is a
 *                          liability, not a feature.
 *   atlas      — Atlas Search: native fuzzy, synonyms, autocomplete, facets.
 *   opensearch — self-hosted, BM25 + function scoring.
 *
 * ── The two-stage design, and why it is the right one here ──────────────────
 * Stage 1 RETRIEVES a bounded candidate set cheaply (indexed match, capped).
 * Stage 2 RANKS those candidates in-process with the pure scorer.
 *
 * Ranking 1 000 candidates costs ~2.4 ms (measured in scripts/ranking.test.js),
 * so the expensive part stays in the database where the indexes are, and the
 * *interesting* part stays in JavaScript where it can be unit-tested, explained
 * and retuned from data. Pushing the whole blend into a Mongo aggregation would
 * make it fast and completely untestable.
 */

const CANDIDATE_CAP = 400;

class MongoSearchProvider {
  get name() { return 'mongo'; }

  async health() {
    const count = await SearchDocument.estimatedDocumentCount();
    return { provider: 'mongo', ok: true, documents: count };
  }

  async index(docs = []) {
    if (!docs.length) return { indexed: 0 };
    const ops = docs.map((d) => ({
      updateOne: {
        filter: { key: d.key },
        update: { $set: { ...d, indexedAt: new Date() } },
        upsert: true,
      },
    }));
    const res = await SearchDocument.bulkWrite(ops, { ordered: false });
    return { indexed: (res.upsertedCount || 0) + (res.modifiedCount || 0) + (res.matchedCount || 0) };
  }

  async remove(keys = []) {
    if (!keys.length) return { removed: 0 };
    const res = await SearchDocument.deleteMany({ key: { $in: keys } });
    return { removed: res.deletedCount || 0 };
  }

  /**
   * Stage 1 — retrieve candidates.
   *
   * Out-of-stock items are RETRIEVED, not excluded: the ranker demotes them
   * below every in-stock item, but a customer searching for something you
   * briefly lack should still learn that you sell it.
   */
  async retrieve({ tenantId, parsed, filters = {}, limit = CANDIDATE_CAP }) {
    const match = {
      tenantId: new mongoose.Types.ObjectId(String(tenantId)),
      status: 'active',
      isDeleted: { $ne: true },
    };

    if (filters.categoryId) match.categoryId = new mongoose.Types.ObjectId(String(filters.categoryId));
    if (filters.vendorId) match.vendorId = new mongoose.Types.ObjectId(String(filters.vendorId));
    if (filters.inStock) match.inStock = true;
    if (filters.minPrice != null || filters.maxPrice != null) {
      match.pricePaise = {
        ...(filters.minPrice != null ? { $gte: Math.round(filters.minPrice * 100) } : {}),
        ...(filters.maxPrice != null ? { $lte: Math.round(filters.maxPrice * 100) } : {}),
      };
    }
    if (filters.colour) match['attributes.colour'] = filters.colour;

    const terms = parsed?.expanded?.length ? parsed.expanded : parsed?.tokens || [];

    if (terms.length) {
      /**
       * A regex OR across the expanded terms rather than `$text`.
       *
       * `$text` cannot see synonym expansions or corrections (it stems its own
       * way), and it cannot do prefix matching — both of which we need. The
       * candidate set is capped, so the cost is bounded even without an index
       * hit on the regex; the tenant+status index still does the heavy lifting.
       */
      const safe = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const rx = new RegExp(safe.join('|'), 'i');
      match.$or = [{ title: rx }, { searchText: rx }, { tags: rx }, { brandName: rx }];
    }

    return SearchDocument.find(match)
      .limit(limit)
      .lean();
  }

  /** Facet counts over the SAME filter set, so the numbers agree with the list. */
  async facets({ tenantId, parsed, filters = {} }) {
    const base = {
      tenantId: new mongoose.Types.ObjectId(String(tenantId)),
      status: 'active',
      isDeleted: { $ne: true },
    };
    const terms = parsed?.expanded?.length ? parsed.expanded : parsed?.tokens || [];
    if (terms.length) {
      const safe = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const rx = new RegExp(safe.join('|'), 'i');
      base.$or = [{ title: rx }, { searchText: rx }, { tags: rx }, { brandName: rx }];
    }

    const [rows] = await SearchDocument.aggregate([
      { $match: base },
      {
        $facet: {
          categories: [
            { $group: { _id: '$categoryId', count: { $sum: 1 }, name: { $first: { $arrayElemAt: ['$categoryPath', -1] } } } },
            { $sort: { count: -1 } },
            { $limit: 12 },
          ],
          availability: [{ $group: { _id: '$inStock', count: { $sum: 1 } } }],
          price: [{
            $group: {
              _id: null,
              min: { $min: '$pricePaise' },
              max: { $max: '$pricePaise' },
            },
          }],
        },
      },
    ]);

    return {
      categories: (rows?.categories || [])
        .filter((c) => c._id)
        .map((c) => ({ id: String(c._id), name: c.name || null, count: c.count })),
      inStock: (rows?.availability || []).find((a) => a._id === true)?.count || 0,
      outOfStock: (rows?.availability || []).find((a) => a._id === false)?.count || 0,
      priceRange: rows?.price?.[0]
        ? { min: (rows.price[0].min || 0) / 100, max: (rows.price[0].max || 0) / 100 }
        : null,
    };
  }

  /** Prefix autocomplete over the bounded `suggest` array. */
  async suggest({ tenantId, prefix, limit = 8 }) {
    const p = String(prefix || '').toLowerCase().trim();
    if (p.length < 2) return [];
    const rx = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const rows = await SearchDocument.find({
      tenantId: new mongoose.Types.ObjectId(String(tenantId)),
      status: 'active',
      suggest: rx,
    })
      .select('title suggest soldCount30d inStock')
      .sort({ inStock: -1, soldCount30d: -1 })
      .limit(limit * 3)
      .lean();

    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const hit = (r.suggest || []).find((s) => rx.test(s)) || r.title;
      const key = hit.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: hit, title: r.title });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Every distinct term in this tenant's catalogue — the typo vocabulary. */
  async vocabulary({ tenantId, limit = 4000 }) {
    const rows = await SearchDocument.find({
      tenantId: new mongoose.Types.ObjectId(String(tenantId)),
      status: 'active',
    })
      .select('suggest')
      .limit(limit)
      .lean();
    const set = new Set();
    for (const r of rows) for (const s of r.suggest || []) set.add(s);
    return [...set];
  }
}

/** Declared seams. Both throw loudly rather than silently degrading. */
class UnimplementedProvider {
  constructor(name) { this.providerName = name; }
  get name() { return this.providerName; }
  async health() { return { provider: this.providerName, ok: false, error: 'not implemented' }; }
  async index() { throw new Error(`${this.providerName} search provider is not implemented yet`); }
  async remove() { throw new Error(`${this.providerName} search provider is not implemented yet`); }
  async retrieve() { throw new Error(`${this.providerName} search provider is not implemented yet`); }
  async facets() { throw new Error(`${this.providerName} search provider is not implemented yet`); }
  async suggest() { throw new Error(`${this.providerName} search provider is not implemented yet`); }
  async vocabulary() { return []; }
}

function build() {
  const p = config.search.provider;
  if (p === 'atlas' || p === 'opensearch') return new UnimplementedProvider(p);
  return new MongoSearchProvider();
}

export const searchProvider = build();
export { MongoSearchProvider, textRelevance, CANDIDATE_CAP };
export default searchProvider;
