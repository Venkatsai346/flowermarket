import SearchMerchandisingRule from '../models/searchMerchandisingRule.model.js';
import { BoundedCache } from '../utils/BoundedCache.js';
import { conflict, notFound } from '../utils/ApiError.js';

const cache = new BoundedCache({ maxEntries: 300, ttlMs: 30_000, name: 'search:merchandising' });

function queryMatches(rule, normalized) {
  const query = String(rule.scope?.query || '').toLowerCase();
  const value = String(normalized || '').toLowerCase();
  if (rule.scope?.match === 'all') return true;
  if (!query) return !value;
  if (rule.scope?.match === 'prefix') return value.startsWith(query);
  if (rule.scope?.match === 'contains') return value.includes(query);
  return value === query;
}

class SearchMerchandisingService {
  invalidate(tenantId) { cache.delete(String(tenantId)); }

  async activeRules(tenantId, now = new Date()) {
    const key = String(tenantId);
    const hit = cache.get(key);
    if (hit) return hit.filter((rule) => (!rule.startsAt || rule.startsAt <= now) && (!rule.endsAt || rule.endsAt > now));
    const rules = await SearchMerchandisingRule.find({
      tenantId, status: 'active', isDeleted: { $ne: true },
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
      ],
    }).sort({ priority: -1, createdAt: 1 }).lean();
    cache.set(key, rules);
    return rules;
  }

  async resolve({ tenantId, normalizedQuery = '', categoryId = null }) {
    const rules = (await this.activeRules(tenantId)).filter((rule) => {
      if (rule.scope?.categoryId && String(rule.scope.categoryId) !== String(categoryId || '')) return false;
      return queryMatches(rule, normalizedQuery);
    });
    const pinIds = [];
    const buryIds = [];
    const boosts = new Map();
    let redirect = null;
    const substitutions = [];
    const shelves = [];
    for (const rule of rules) {
      const listings = (rule.target?.listingIds || []).map(String);
      if (rule.type === 'pin') pinIds.push(...listings);
      else if (rule.type === 'bury') buryIds.push(...listings);
      else if (rule.type === 'boost') for (const id of listings) boosts.set(id, (boosts.get(id) || 0) + Number(rule.boost || 0));
      else if (rule.type === 'redirect' && !redirect) redirect = { path: rule.target?.redirectPath, ruleCode: rule.code };
      else if (rule.type === 'substitute') substitutions.push({
        ruleCode: rule.code, from: listings, to: (rule.target?.substituteListingIds || []).map(String),
      });
      else if (rule.type === 'shelf') shelves.push({
        ruleCode: rule.code, title: rule.target?.shelfTitle || rule.name,
        listingIds: listings, masterIds: (rule.target?.masterIds || []).map(String),
      });
    }
    return {
      pins: [...new Set(pinIds)], buries: [...new Set(buryIds)], boosts, redirect, substitutions, shelves,
      appliedRuleCodes: rules.map((rule) => rule.code),
    };
  }

  async list({ tenantId, status = null, type = null }) {
    const query = { tenantId, isDeleted: { $ne: true } };
    if (status) query.status = status;
    if (type) query.type = type;
    return SearchMerchandisingRule.find(query).sort({ priority: -1, updatedAt: -1 }).lean();
  }

  async create({ tenantId, payload, actorId }) {
    try {
      const row = await SearchMerchandisingRule.create({ ...payload, tenantId, createdBy: actorId, updatedBy: actorId });
      this.invalidate(tenantId);
      return row;
    } catch (error) {
      if (error?.code === 11000) throw conflict('A merchandising rule with this code and type already exists.', 'MERCHANDISING_RULE_EXISTS');
      throw error;
    }
  }

  async update({ tenantId, id, payload, expectedVersion, actorId }) {
    const version = Number(expectedVersion);
    const existing = await SearchMerchandisingRule.findOne({ _id: id, tenantId, isDeleted: { $ne: true } }).lean();
    if (!existing) throw notFound('Merchandising rule not found', 'MERCHANDISING_RULE_NOT_FOUND');
    if (existing.version !== version) throw conflict('This rule changed since it was opened. Refresh and retry.', 'VERSION_CONFLICT');
    const candidate = new SearchMerchandisingRule({ ...existing, ...payload, _id: existing._id });
    await candidate.validate();
    const row = await SearchMerchandisingRule.findOneAndUpdate(
      { _id: id, tenantId, version, isDeleted: { $ne: true } },
      { $set: { ...payload, updatedBy: actorId }, $inc: { version: 1 } },
      { new: true, runValidators: true },
    );
    if (!row) {
      const exists = await SearchMerchandisingRule.exists({ _id: id, tenantId, isDeleted: { $ne: true } });
      if (!exists) throw notFound('Merchandising rule not found', 'MERCHANDISING_RULE_NOT_FOUND');
      throw conflict('This rule changed since it was opened. Refresh and retry.', 'VERSION_CONFLICT');
    }
    this.invalidate(tenantId);
    return row;
  }

  async remove({ tenantId, id }) {
    const row = await SearchMerchandisingRule.findOneAndUpdate(
      { _id: id, tenantId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date(), status: 'paused' }, $inc: { version: 1 } },
      { new: true },
    );
    if (!row) throw notFound('Merchandising rule not found', 'MERCHANDISING_RULE_NOT_FOUND');
    this.invalidate(tenantId);
    return { id: String(row._id), deleted: true };
  }
}

export default new SearchMerchandisingService();
