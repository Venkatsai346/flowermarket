import searchService from '../services/search.service.js';
import searchIndexer from '../services/searchIndexer.service.js';
import searchProvider from '../services/searchProvider.service.js';
import searchMerchandisingService from '../services/searchMerchandising.service.js';
import auditService from '../services/audit.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';
import { AUDIT_ACTION, USER_ROLES } from '../constants/enums.js';
import { forbidden } from '../utils/ApiError.js';

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
  shelves = asyncHandler(async (req, res) => {
    const resolved = await searchMerchandisingService.resolve({
      tenantId: req.tenantId, normalizedQuery: '', categoryId: req.query.categoryId || null,
    });
    res.status(200).json(success(resolved.shelves, { message: 'Curated shelves fetched' }));
  });

  event = asyncHandler(async (req, res) => {
    const result = await searchService.recordEvent({
      tenantId: req.tenantId,
      sessionKey: req.get('x-session-id') || req.ip || null,
      queryId: req.body.queryId,
      eventId: req.body.eventId,
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

  merchandisingRules = asyncHandler(async (req, res) => {
    const rows = await searchMerchandisingService.list({
      tenantId: req.tenantId, status: req.query.status || null, type: req.query.type || null,
    });
    res.status(200).json(success(rows, { message: 'Merchandising rules fetched' }));
  });

  createMerchandisingRule = asyncHandler(async (req, res) => {
    const row = await searchMerchandisingService.create({ tenantId: req.tenantId, payload: req.body, actorId: req.auth.userId });
    await auditService.record({
      action: AUDIT_ACTION.RANKING_CHANGE, entityType: 'search_merchandising_rule', entityId: row._id,
      tenantId: req.tenantId, actorId: req.auth.userId, actorType: 'admin', after: row.toJSON(), req,
    });
    res.status(201).json(created(row, { message: 'Merchandising rule created' }));
  });

  updateMerchandisingRule = asyncHandler(async (req, res) => {
    const { expectedVersion, ...payload } = req.body;
    const row = await searchMerchandisingService.update({
      tenantId: req.tenantId, id: req.params.id, payload, expectedVersion, actorId: req.auth.userId,
    });
    await auditService.record({
      action: AUDIT_ACTION.RANKING_CHANGE, entityType: 'search_merchandising_rule', entityId: row._id,
      tenantId: req.tenantId, actorId: req.auth.userId, actorType: 'admin', after: row.toJSON(), req,
    });
    res.status(200).json(success(row, { message: 'Merchandising rule updated' }));
  });

  deleteMerchandisingRule = asyncHandler(async (req, res) => {
    const result = await searchMerchandisingService.remove({ tenantId: req.tenantId, id: req.params.id });
    await auditService.record({
      action: AUDIT_ACTION.RANKING_CHANGE, entityType: 'search_merchandising_rule', entityId: req.params.id,
      tenantId: req.tenantId, actorId: req.auth.userId, actorType: 'admin', after: result, req,
    });
    res.status(200).json(success(result, { message: 'Merchandising rule deleted' }));
  });

  reindex = asyncHandler(async (req, res) => {
    const allTenants = req.body?.allTenants === true;
    if (allTenants && req.auth.role !== USER_ROLES.SUPER_ADMIN) {
      throw forbidden('Only a super admin can rebuild the global search index.', 'GLOBAL_REINDEX_FORBIDDEN');
    }
    const result = await searchIndexer.reindexAll({
      tenantId: allTenants ? null : req.tenantId,
      after: req.body.after || null,
    });
    await auditService.record({
      action: AUDIT_ACTION.SEARCH_REINDEX, entityType: 'search_index', entityId: req.tenantId || req.auth.userId,
      tenantId: allTenants ? null : req.tenantId, actorId: req.auth.userId, actorType: 'admin', after: result, req,
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
