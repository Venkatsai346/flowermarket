import AuditLog from '../models/auditLog.model.js';
import { badRequest } from '../utils/ApiError.js';

/**
 * AuditService — immutable audit trail. Only insert & query are exposed;
 * there is deliberately NO update/delete path.
 */
class AuditService {
  /**
   * @param {object} p
   * @param {string} p.action            AUDIT_ACTION value
   * @param {string} p.entityType        e.g. 'product_master', 'tenant_product'
   * @param {string|objectId} p.entityId
   * @param {string|null} p.tenantId
   * @param {string|null} p.actorId
   * @param {string} [p.actorType]       'tenant' | 'admin' | 'system'
   * @param {object} [p.before]          pre-change snapshot (scrubbed)
   * @param {object} [p.after]           post-change snapshot (scrubbed)
   * @param {object} [p.meta]
   * @param {import('express').Request} [p.req]  for ip + requestId
   */
  async record({ action, entityType, entityId, tenantId = null, actorId = null, actorType = 'system', before = null, after = null, meta = null, req = null }) {
    if (!action || !entityType || !entityId) {
      throw badRequest('action, entityType and entityId are required for audit', 'AUDIT_INVALID');
    }
    return AuditLog.create({
      action,
      entityType,
      entityId,
      tenantId: tenantId || null,
      actorId: actorId || null,
      actorType,
      before,
      after,
      meta,
      ipAddress: req?.ip || null,
      requestId: req?.id || null,
    });
  }

  /**
   * Query audit logs. Non-admins are strictly scoped to their own tenantId.
   */
  async query({ tenantId = null, filters = {}, isAdmin = false, page = 1, limit = 20 }) {
    const q = {};
    if (isAdmin) {
      if (filters.tenantId) q.tenantId = filters.tenantId;
    } else {
      if (!tenantId) throw badRequest('Tenant scope is required', 'TENANT_SCOPE_REQUIRED');
      q.tenantId = tenantId;
    }
    if (filters.entityType) q.entityType = filters.entityType;
    if (filters.entityId) q.entityId = filters.entityId;
    if (filters.action) q.action = filters.action;
    if (filters.actorId) q.actorId = filters.actorId;
    if (filters.from || filters.to) {
      q.createdAt = {
        ...(filters.from ? { $gte: new Date(filters.from) } : {}),
        ...(filters.to ? { $lte: new Date(filters.to) } : {}),
      };
    }

    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      AuditLog.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(q),
    ]);
    return { items: docs, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: skip + docs.length < total } };
  }
}

export default new AuditService();
