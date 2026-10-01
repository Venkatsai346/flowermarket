import crypto from 'node:crypto';
import mongoose from 'mongoose';
import SearchInteraction from '../models/searchInteraction.model.js';
import SearchDocument from '../models/searchDocument.model.js';
import OrderItem from '../models/orderItem.model.js';
import searchProvider from './searchProvider.service.js';
import { searchInteractionEvents, searchRollups } from '../observability/registry.js';

function sessionHash(value) {
  return value ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16) : null;
}

class SearchAnalyticsService {
  hashSession(value) { return sessionHash(value); }

  async recordQuery({ tenantId, sessionKey, queryId, normalizedQuery, profileCode, experimentBucket, resultCount, latencyMs, candidateListingIds, candidateMasterIds }) {
    const result = await SearchInteraction.updateOne(
      { tenantId, eventId: `query:${queryId}` },
      { $setOnInsert: {
        tenantId, eventId: `query:${queryId}`, queryId, sessionHash: sessionHash(sessionKey), type: 'query',
        normalizedQuery: String(normalizedQuery || '').slice(0, 200), profileCode, experimentBucket,
        resultCount, zeroResult: resultCount === 0, latencyMs: Math.max(0, Math.round(latencyMs || 0)),
        candidateListingIds: [...new Set(candidateListingIds || [])].slice(0, 1000),
        candidateMasterIds: [...new Set(candidateMasterIds || [])].slice(0, 1000), source: 'api', occurredAt: new Date(),
      } },
      { upsert: true },
    );
    searchInteractionEvents.inc({ type: 'query', outcome: result.upsertedCount ? 'recorded' : 'duplicate' });
    return result;
  }

  async isCandidate({ tenantId, query, listingId }) {
    if ((query.candidateListingIds || []).includes(String(listingId))) return true;
    if (!(query.candidateMasterIds || []).length) return false;
    return Boolean(await SearchDocument.exists({
      tenantId, listingId, masterId: { $in: query.candidateMasterIds }, status: 'active',
    }));
  }

  async validateAttribution({ tenantId, sessionKey, queryId, listingId }) {
    if (!queryId || !listingId) return false;
    const query = await SearchInteraction.findOne({ tenantId, eventId: `query:${queryId}`, type: 'query' }).lean();
    if (!query) return false;
    const hash = sessionHash(sessionKey);
    if (query.sessionHash && query.sessionHash !== hash) return false;
    return this.isCandidate({ tenantId, query, listingId });
  }

  async recordEvent({ tenantId, sessionKey, queryId, eventId, type, position = null, listingId = null }) {
    const reject = (reason) => {
      searchInteractionEvents.inc({ type: type || 'unknown', outcome: reason });
      return { recorded: false, reason };
    };
    if (!queryId || !eventId || !listingId) return reject('missing_context');
    const query = await SearchInteraction.findOne({ tenantId, eventId: `query:${queryId}`, type: 'query' }).lean();
    if (!query) return reject('unknown_query');
    const hash = sessionHash(sessionKey);
    if (query.sessionHash && query.sessionHash !== hash) return reject('session_mismatch');
    if (!await this.isCandidate({ tenantId, query, listingId })) return reject('listing_not_in_results');
    try {
      await SearchInteraction.create({
        tenantId, eventId, queryId, sessionHash: hash, type, listingId,
        position, normalizedQuery: query.normalizedQuery, profileCode: query.profileCode,
        experimentBucket: query.experimentBucket, source: 'storefront', occurredAt: new Date(),
      });
      searchInteractionEvents.inc({ type, outcome: 'recorded' });
      return { recorded: true };
    } catch (error) {
      if (error?.code === 11000) return reject('duplicate');
      throw error;
    }
  }

  async analytics({ tenantId, from = null, to = null }) {
    const occurredAt = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    };
    const match = { tenantId: new mongoose.Types.ObjectId(String(tenantId)), ...(Object.keys(occurredAt).length ? { occurredAt } : {}) };
    const [queries, funnel, experiments, latency, purchases, overall, productEvents, productPurchases] = await Promise.all([
      SearchInteraction.aggregate([
        { $match: { ...match, type: 'query', normalizedQuery: { $ne: '' } } },
        { $group: { _id: '$normalizedQuery', searches: { $sum: 1 }, zero: { $sum: { $cond: ['$zeroResult', 1, 0] } } } },
        { $sort: { searches: -1 } }, { $limit: 50 },
      ]),
      SearchInteraction.aggregate([
        { $match: { ...match, type: { $in: ['impression', 'click', 'add_to_cart', 'purchase'] } } },
        { $group: { _id: { query: '$normalizedQuery', type: '$type' }, count: { $sum: 1 }, revenuePaise: { $sum: { $ifNull: ['$revenuePaise', 0] } } } },
      ]),
      SearchInteraction.aggregate([
        { $match: match },
        { $group: {
          _id: { bucket: '$experimentBucket', type: '$type' }, count: { $sum: 1 },
          zero: { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'query'] }, '$zeroResult'] }, 1, 0] } },
        } },
      ]),
      SearchInteraction.aggregate([
        { $match: { ...match, type: 'query' } },
        { $group: { _id: null, avg: { $avg: '$latencyMs' }, max: { $max: '$latencyMs' }, count: { $sum: 1 } } },
      ]),
      OrderItem.aggregate([
        { $match: { tenantId: match.tenantId, searchQueryId: { $ne: null }, isDeleted: { $ne: true } } },
        { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
        { $unwind: '$order' },
        { $match: {
          ...(Object.keys(occurredAt).length ? { 'order.createdAt': occurredAt } : {}),
          'order.status': { $nin: ['created', 'payment_pending', 'cancelled'] }, 'order.isDeleted': { $ne: true },
        } },
        { $lookup: {
          from: 'searchinteractions', let: { event: { $concat: ['query:', '$searchQueryId'] } },
          pipeline: [{ $match: { $expr: { $and: [
            { $eq: ['$tenantId', match.tenantId] }, { $eq: ['$eventId', '$$event'] }, { $eq: ['$type', 'query'] },
          ] } } }], as: 'queryEvent',
        } },
        { $unwind: '$queryEvent' },
        { $group: {
          _id: { query: '$queryEvent.normalizedQuery', bucket: '$queryEvent.experimentBucket' },
          count: { $sum: 1 },
          revenuePaise: { $sum: { $round: [{ $multiply: ['$lineTotal', 100] }, 0] } },
        } },
      ]),
      SearchInteraction.aggregate([
        { $match: match },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      SearchInteraction.aggregate([
        { $match: { ...match, listingId: { $ne: null }, type: { $in: ['impression', 'click', 'add_to_cart'] } } },
        { $group: { _id: { listingId: '$listingId', type: '$type' }, count: { $sum: 1 } } },
      ]),
      OrderItem.aggregate([
        { $match: { tenantId: match.tenantId, searchQueryId: { $ne: null }, isDeleted: { $ne: true } } },
        { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
        { $unwind: '$order' },
        { $match: {
          ...(Object.keys(occurredAt).length ? { 'order.createdAt': occurredAt } : {}),
          'order.status': { $nin: ['created', 'payment_pending', 'cancelled'] }, 'order.isDeleted': { $ne: true },
        } },
        { $group: {
          _id: '$tenantProductId', count: { $sum: 1 },
          revenuePaise: { $sum: { $round: [{ $multiply: ['$lineTotal', 100] }, 0] } },
        } },
      ]),
    ]);
    const funnelMap = new Map();
    for (const row of funnel) {
      if (!funnelMap.has(row._id.query)) funnelMap.set(row._id.query, {});
      funnelMap.get(row._id.query)[row._id.type] = { count: row.count, revenuePaise: row.revenuePaise };
    }
    for (const row of purchases) {
      if (!funnelMap.has(row._id.query)) funnelMap.set(row._id.query, {});
      funnelMap.get(row._id.query).purchase = { count: row.count, revenuePaise: row.revenuePaise };
    }
    const topQueries = queries.map((row) => {
      const f = funnelMap.get(row._id) || {};
      const impressions = f.impression?.count || 0;
      const clicks = f.click?.count || 0;
      const carts = f.add_to_cart?.count || 0;
      const purchases = f.purchase?.count || 0;
      return {
        query: row._id, searches: row.searches, impressions, clicks, carts, purchases,
        revenue: (f.purchase?.revenuePaise || 0) / 100,
        ctr: impressions ? clicks / impressions : 0,
        addToCartRate: clicks ? carts / clicks : 0,
        conversionRate: clicks ? purchases / clicks : 0,
      };
    });
    const experimentMap = new Map();
    for (const row of experiments) {
      const key = row._id.bucket || 'control';
      if (!experimentMap.has(key)) experimentMap.set(key, {});
      experimentMap.get(key)[row._id.type] = row.count;
      if (row._id.type === 'query') experimentMap.get(key).zero = row.zero || 0;
    }
    for (const row of purchases) {
      const key = row._id.bucket || 'control';
      if (!experimentMap.has(key)) experimentMap.set(key, {});
      experimentMap.get(key).purchase = row.count;
    }
    const experimentRows = [...experimentMap.entries()].map(([bucket, values]) => ({
      bucket, searches: values.query || 0,
      clickThroughRate: values.impression ? (values.click || 0) / values.impression : 0,
      addToCartRate: values.click ? (values.add_to_cart || 0) / values.click : 0,
      purchaseRate: values.click ? (values.purchase || 0) / values.click : 0,
      zeroResultRate: values.query ? (values.zero || 0) / values.query : 0,
    }));
    const latencyCount = latency[0]?.count || 0;
    const p95Row = latencyCount ? await SearchInteraction.findOne({ ...match, type: 'query' })
      .sort({ latencyMs: 1 }).skip(Math.max(0, Math.ceil(latencyCount * 0.95) - 1)).select('latencyMs').lean() : null;
    const overallMap = Object.fromEntries(overall.map((row) => [row._id, row.count]));
    const productMap = new Map();
    for (const row of productEvents) {
      const key = String(row._id.listingId);
      if (!productMap.has(key)) productMap.set(key, { listingId: key, impressions: 0, clicks: 0, carts: 0, purchases: 0, revenue: 0 });
      const field = row._id.type === 'add_to_cart' ? 'carts' : `${row._id.type}s`;
      productMap.get(key)[field] = row.count;
    }
    for (const row of productPurchases) {
      const key = String(row._id);
      if (!productMap.has(key)) productMap.set(key, { listingId: key, impressions: 0, clicks: 0, carts: 0, purchases: 0, revenue: 0 });
      productMap.get(key).purchases = row.count;
      productMap.get(key).revenue = row.revenuePaise / 100;
    }
    const productIds = [...productMap.keys()];
    const productDocs = productIds.length
      ? await SearchDocument.find({ tenantId: match.tenantId, listingId: { $in: productIds } }).select('listingId title').lean()
      : [];
    const titleByListing = new Map(productDocs.map((doc) => [String(doc.listingId), doc.title]));
    const products = [...productMap.values()].map((row) => ({
      ...row, title: titleByListing.get(row.listingId) || 'Unknown product',
      ctr: row.impressions ? row.clicks / row.impressions : 0,
      conversionRate: row.clicks ? row.purchases / row.clicks : 0,
    })).sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks).slice(0, 50);
    const purchaseCount = purchases.reduce((sum, row) => sum + row.count, 0);
    const purchaseRevenue = purchases.reduce((sum, row) => sum + row.revenuePaise, 0) / 100;
    return {
      topQueries: topQueries.slice(0, 20),
      zeroResultQueries: queries.filter((row) => row.zero > 0).sort((a, b) => b.zero - a.zero).slice(0, 20).map((row) => ({ query: row._id, searches: row.zero })),
      experiments: experimentRows,
      products,
      latency: {
        avgMs: Math.round(latency[0]?.avg || 0), maxMs: latency[0]?.max || 0,
        p95Ms: p95Row?.latencyMs || 0,
      },
      totals: {
        searches: overallMap.query || 0, impressions: overallMap.impression || 0,
        clicks: overallMap.click || 0, carts: overallMap.add_to_cart || 0,
        purchases: purchaseCount, revenue: purchaseRevenue,
      },
    };
  }

  /** Replace lifetime popularity masquerading as recency with true rolling 30-day facts. */
  async rollup30d({ tenantId }) {
    const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId));
    const since = new Date(Date.now() - 30 * 86400000);
    const purchaseFacts = await OrderItem.aggregate([
      { $match: { tenantId: tenantObjectId, searchQueryId: { $ne: null }, isDeleted: { $ne: true } } },
      { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
      { $unwind: '$order' },
      { $match: { 'order.createdAt': { $gte: since }, 'order.status': { $nin: ['created', 'payment_pending', 'cancelled'] }, 'order.isDeleted': { $ne: true } } },
      { $lookup: {
        from: 'searchinteractions', let: { event: { $concat: ['query:', '$searchQueryId'] } },
        pipeline: [{ $match: { $expr: { $and: [
          { $eq: ['$tenantId', tenantObjectId] }, { $eq: ['$eventId', '$$event'] }, { $eq: ['$type', 'query'] },
        ] } } }], as: 'queryEvent',
      } },
      { $unwind: '$queryEvent' },
      { $project: {
        eventId: { $concat: ['purchase:', { $toString: '$_id' }] }, queryId: '$searchQueryId', listingId: '$tenantProductId', masterId: '$productMasterId',
        quantity: '$qty', revenuePaise: { $round: [{ $multiply: ['$lineTotal', 100] }, 0] }, occurredAt: '$order.createdAt',
        normalizedQuery: '$queryEvent.normalizedQuery', profileCode: '$queryEvent.profileCode', experimentBucket: '$queryEvent.experimentBucket',
      } },
    ]);
    if (purchaseFacts.length) {
      await SearchInteraction.bulkWrite(purchaseFacts.map((fact) => ({ updateOne: {
        filter: { tenantId: tenantObjectId, eventId: fact.eventId },
        update: { $setOnInsert: { ...fact, tenantId: tenantObjectId, type: 'purchase', source: 'order' } }, upsert: true,
      } })), { ordered: false });
    }
    const [engagement, sales] = await Promise.all([
      SearchInteraction.aggregate([
        { $match: { tenantId: tenantObjectId, occurredAt: { $gte: since }, listingId: { $ne: null }, type: { $in: ['impression', 'click'] } } },
        { $group: {
          _id: '$listingId', impressions: { $sum: { $cond: [{ $eq: ['$type', 'impression'] }, 1, 0] } },
          clicks: { $sum: { $cond: [{ $eq: ['$type', 'click'] }, 1, 0] } },
        } },
      ]),
      OrderItem.aggregate([
        { $match: { tenantId: tenantObjectId, isDeleted: { $ne: true } } },
        { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
        { $unwind: '$order' },
        { $match: { 'order.createdAt': { $gte: since }, 'order.status': { $nin: ['created', 'payment_pending', 'cancelled'] }, 'order.isDeleted': { $ne: true } } },
        { $group: {
          _id: '$tenantProductId', sold: { $sum: { $max: [{ $subtract: ['$qty', { $ifNull: ['$cancelledQty', 0] }] }, 0] } },
          returned: { $sum: { $ifNull: ['$returnedQty', 0] } }, total: { $sum: '$qty' },
        } },
      ]),
    ]);
    const byListing = new Map();
    for (const row of engagement) byListing.set(String(row._id), { impressions: row.impressions, clicks: row.clicks, sold: 0, returned: 0, total: 0 });
    for (const row of sales) byListing.set(String(row._id), { ...(byListing.get(String(row._id)) || { impressions: 0, clicks: 0 }), sold: row.sold, returned: row.returned, total: row.total });
    const listingIds = [...byListing.keys()];
    await SearchDocument.updateMany({ tenantId: tenantObjectId }, { $set: { impressions30d: 0, clicks30d: 0, soldCount30d: 0, returnRate30d: 0 } });
    if (listingIds.length) {
      await SearchDocument.bulkWrite(listingIds.map((id) => {
        const value = byListing.get(id);
        return { updateOne: {
          filter: { tenantId: tenantObjectId, listingId: id },
          update: { $set: {
            impressions30d: value.impressions, clicks30d: value.clicks, soldCount30d: value.sold,
            returnRate30d: value.total ? Math.min(1, value.returned / value.total) : 0,
          } },
        } };
      }), { ordered: false });
    }
    const docs = await SearchDocument.find({ tenantId: tenantObjectId }).lean();
    for (let index = 0; index < docs.length; index += 500) {
      // Provider batches are deliberately sequential because each bounded bulk must succeed before nightly reports completion.
      // eslint-disable-next-line no-await-in-loop
      await searchProvider.index(docs.slice(index, index + 500), { canonical: false });
    }
    searchRollups.inc({ outcome: 'success' });
    return {
      listingsUpdated: docs.length, engagementRows: engagement.length, salesRows: sales.length,
      purchaseEventsMaterialized: purchaseFacts.length, windowStart: since,
    };
  }
}

export default new SearchAnalyticsService();
