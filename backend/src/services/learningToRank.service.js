/**
 * LearningToRankService — search relevance optimization.
 *
 * Collects user interaction signals (clicks, add-to-cart, purchases)
 * and uses them to rank search results. Products that users engage with
 * rank higher for relevant queries.
 *
 * This is a lightweight implementation — no ML model training needed.
 * Uses a scoring function that combines:
 *   - Text relevance (existing search score)
 *   - Popularity (click-through rate)
 *   - Freshness (recently updated)
 *   - Availability (in-stock preference)
 *   - Rating (customer reviews)
 *
 * For production ML-based LTR, integrate with:
 *   - LambdaMART (LightGBM)
 *   - TensorFlow Ranking
 *   - Elasticsearch LTR plugin
 */

import SearchQueryLog from '../models/searchQueryLog.model.js';
import TenantProduct from '../models/tenantProduct.model.js';

class LearningToRankService {
  /**
   * Re-rank search results using engagement signals.
   */
  async rerank({ tenantId, query, results }) {
    if (!results?.length) return results;

    // Get engagement signals for these products
    const productIds = results.map((r) => r._id || r.id);

    // Get click/purchase signals from query logs
    const signals = await SearchQueryLog.aggregate([
      {
        $match: {
          tenantId,
          query: { $regex: query, $options: 'i' },
          clickedProductIds: { $in: productIds },
        },
      },
      { $unwind: '$clickedProductIds' },
      { $match: { clickedProductIds: { $in: productIds } } },
      { $group: { _id: '$clickedProductIds', clicks: { $sum: 1 } } },
    ]);

    const signalMap = new Map(signals.map((s) => [String(s._id), s.clicks]));

    // Get product metadata for scoring
    const products = await TenantProduct.find({ _id: { $in: productIds } })
      .select('stockQty availability rating updatedAt')
      .lean();
    const productMap = new Map(products.map((p) => [String(p._id), p]));

    // Score each result
    const scored = results.map((result) => {
      const id = String(result._id || result.id);
      const product = productMap.get(id);
      const clicks = signalMap.get(id) || 0;

      let score = result._score || result.score || 0;

      // Popularity boost (clicks)
      score += Math.log1p(clicks) * 2;

      // Availability boost
      if (product?.stockQty > 0) score += 3;
      if (product?.availability?.status === 'out_of_stock') score -= 10;

      // Rating boost
      if (product?.rating?.average > 0) {
        score += product.rating.average * 0.5;
      }

      // Freshness boost (updated in last 7 days)
      if (product?.updatedAt) {
        const age = Date.now() - new Date(product.updatedAt).getTime();
        if (age < 7 * 86400000) score += 1;
      }

      return { ...result, _rerankedScore: score };
    });

    // Sort by reranked score
    scored.sort((a, b) => b._rerankedScore - a._rerankedScore);
    return scored;
  }

  /**
   * Record a search interaction (click or purchase).
   */
  async recordInteraction({ tenantId, userId, query, productId, type }) {
    // Update the most recent query log for this user/query
    await SearchQueryLog.updateOne(
      { tenantId, userId, query: { $regex: `^${query}$`, $options: 'i' } },
      {
        $push: {
          clickedProductIds: productId,
          interactions: { type, productId, timestamp: new Date() },
        },
      },
      { sort: { createdAt: -1 } },
    );
  }
}

export default new LearningToRankService();
