import searchService from '../services/search.service.js';
import searchIndexer from '../services/searchIndexer.service.js';
import searchProvider from '../services/searchProvider.service.js';
import auditService from '../services/audit.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';
import { AUDIT_ACTION } from '../constants/enums.js';

class SearchController {
  // ---------------- public ----------------
  suggest = asyncHandler(async (req, res) => {
    const items = await searchService.suggest({ tenantId: req.tenantId, prefix: req.query.q });
    res.status(200).json(success(items, { message: 'Suggestions fetched' }));
  });

  /**
   * Click / add-to-cart beacon. Fire-and-forget from the client, and the only
   * way the platform ever learns whether a ranking change helped.
   */
  event = asyncHandler(async (req, res) => {
    const result = await searchService.recordEvent({
      queryId: req.body.queryId,
      type: req.body.type,
      position: req.body.position,
      listingId: req.body.listingId,
    });
    res.status(202).json(success(result, { message: 'Recorded' }));
  });

  // ---------------- admin ----------------
  profiles = asyncHandler(async (req, res) => {
    res.status(200).json(success(await searchService.listProfiles({ tenantId: req.tenantId }), { message: 'Ranking profiles fetched' }));
  });

  saveProfile = asyncHandler(async (req, res) => {
    const doc = await searchService.upsertProfile({ tenantId: req.tenantId, payload: req.body });
    await auditService.record({
      action: AUDIT_ACTION.RANKING_CHANGE, entityType: 'ranking_profile', entityId: doc._id,
      tenantId: req.tenantId, actorId: req.auth.userId, actorType: 'admin',
      after: { code: doc.code, weights: doc.weights, trafficPct: doc.trafficPct }, req,
    }).catch(() => {});
    res.status(201).json(created(doc, { message: 'Ranking profile saved' }));
  });

  synonyms = asyncHandler(async (req, res) => {
    res.status(200).json(success(await searchService.listSynonyms({ tenantId: req.tenantId }), { message: 'Synonyms fetched' }));
  });

  createSynonym = asyncHandler(async (req, res) => {
    const doc = await searchService.createSynonym({ tenantId: req.tenantId, payload: req.body });
    res.status(201).json(created(doc, { message: 'Synonym added' }));
  });

  reindex = asyncHandler(async (req, res) => {
    const result = await searchIndexer.reindexAll({
      tenantId: req.body.allTenants ? null : req.tenantId,
      after: req.body.after || null,
    });
    await auditService.record({
      action: AUDIT_ACTION.SEARCH_REINDEX, entityType: 'search_index', entityId: req.tenantId,
      tenantId: req.tenantId, actorId: req.auth.userId, actorType: 'admin', after: result, req,
    }).catch(() => {});
    res.status(200).json(success(result, { message: 'Reindex complete' }));
  });

  health = asyncHandler(async (req, res) => {
    const [provider, freshness] = await Promise.all([
      searchProvider.health(),
      searchIndexer.freshnessCheck({ repair: false }),
    ]);
    res.status(200).json(success({ provider, freshness }, { message: 'Search health' }));
  });

  analytics = asyncHandler(async (req, res) => {
    const result = await searchService.analytics({
      tenantId: req.tenantId, from: req.query.from || null, to: req.query.to || null,
    });
    res.status(200).json(success(result, { message: 'Search analytics' }));
  });
}

export default new SearchController();
