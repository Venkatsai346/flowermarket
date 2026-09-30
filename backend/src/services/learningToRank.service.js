/**
 * Compatibility adapter for callers that still request an extra reranking pass.
 *
 * The authoritative learning signals now live on SearchDocument and are
 * materialized from the append-only interaction stream. This adapter must not
 * read or mutate sampled SearchQueryLog arrays: doing so would make behaviour
 * depend on sampling and on which API replica handled a beacon.
 */
import SearchDocument from '../models/searchDocument.model.js';
import searchAnalyticsService from './searchAnalytics.service.js';

class LearningToRankService {
  async rerank({ tenantId, results }) {
    if (!results?.length) return results;
    const listingIds = results.map((result) => result.listingId || result._id || result.id).filter(Boolean);
    const signals = await SearchDocument.find({ tenantId, listingId: { $in: listingIds } })
      .select('listingId soldCount30d clicks30d impressions30d returnRate30d inStock').lean();
    const byListing = new Map(signals.map((row) => [String(row.listingId), row]));
    return results.map((result) => {
      const id = String(result.listingId || result._id || result.id);
      const signal = byListing.get(id);
      const impressions = signal?.impressions30d || 0;
      const ctr = (signal?.clicks30d || 0) / Math.max(20, impressions);
      const learnedBoost = Math.log1p(signal?.soldCount30d || 0) + (ctr * 2) - (signal?.returnRate30d || 0);
      return { ...result, _rerankedScore: Number(result._score || result.score || 0) + learnedBoost };
    }).sort((a, b) => b._rerankedScore - a._rerankedScore);
  }

  /** New callers must provide the same server-minted attribution as the public beacon. */
  async recordInteraction({ tenantId, sessionKey, queryId, eventId, listingId, productId, type, position = null }) {
    return searchAnalyticsService.recordEvent({
      tenantId, sessionKey, queryId, eventId, listingId: listingId || productId, type, position,
    });
  }
}

export default new LearningToRankService();
