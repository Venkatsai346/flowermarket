import Category from '../models/category.model.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { uniqueSlug, assertSlugFree } from '../utils/slugify.js';
import auditService from './audit.service.js';
import catalogEventService from './catalogEvent.service.js';
import { ATTRIBUTE_FIELD_TYPE } from '../constants/enums.js';

/**
 * CategoryService — global taxonomy management (admin-owned per the architecture
 * doc: tenants read taxonomy read-only and can never create categories).
 */
class CategoryService {
  async create({ payload, actorId = null, req = null }) {
    if (payload.parentId) {
      const parent = await Category.findById(payload.parentId);
      if (!parent) throw notFound('Parent category not found', 'CATEGORY_NOT_FOUND');
    }
    const slug = payload.slug
      ? (await assertSlugFree(Category, payload.slug)) && payload.slug
      : await uniqueSlug(Category, payload.name);
    const parent = payload.parentId ? await Category.findById(payload.parentId).lean() : null;
    const level = parent ? (parent.level || 0) + 1 : 0;

    const cat = await Category.create({ ...payload, slug, level, parentId: payload.parentId || null });
    await auditService.record({
      action: 'create', entityType: 'category', entityId: cat.id,
      actorId, actorType: actorId ? 'admin' : 'system', after: { name: cat.name, slug: cat.slug, level },
      req,
    });
    await catalogEventService.publish({
      eventType: 'category_updated', entityType: 'category', entityId: cat.id,
      payload: { id: cat.id, name: cat.name, slug: cat.slug, status: cat.status },
    });
    return cat;
  }

  async update({ id, patch, actorId = null, req = null }) {
    const cat = await Category.findById(id);
    if (!cat) throw notFound('Category not found', 'CATEGORY_NOT_FOUND');
    const before = { name: cat.name, slug: cat.slug, status: cat.status };

    if (patch.slug) await assertSlugFree(Category, patch.slug, {}, id);
    if (patch.parentId && String(patch.parentId) !== String(cat.parentId || '')) {
      const parent = await Category.findById(patch.parentId);
      if (!parent) throw notFound('Parent category not found', 'CATEGORY_NOT_FOUND');
      if (String(parent.parentId || '') === String(id)) {
        throw badRequest('Cannot move a category under its own child', 'CATEGORY_CYCLE');
      }
      patch.level = (parent.level || 0) + 1;
    }
    if (patch.parentId === null || patch.parentId === '') {
      patch.parentId = null;
      patch.level = 0;
    }

    Object.assign(cat, patch);
    await cat.save();
    await auditService.record({
      action: 'update', entityType: 'category', entityId: cat.id,
      actorId, actorType: 'admin', before, after: { name: cat.name, slug: cat.slug, status: cat.status }, req,
    });
    await catalogEventService.publish({
      eventType: 'category_updated', entityType: 'category', entityId: cat.id,
      payload: { id: cat.id, name: cat.name, status: cat.status },
    });
    return cat;
  }

  async list({ includeInactive = false, parentId = null, featured = false, page = 1, limit = 50 } = {}) {
    const q = {};
    if (!includeInactive) q.status = { $ne: 'inactive' };
    if (parentId) q.parentId = parentId;
    if (featured) q.isFeatured = true;
    const docs = await Category.find(q).sort({ sortOrder: 1, name: 1 }).skip((page - 1) * limit).limit(limit).lean();
    const total = await Category.countDocuments(q);
    return { items: docs, meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  /** Full tree (bounded recursion via parent refs). */
  async tree({ includeInactive = false } = {}) {
    const q = {};
    if (!includeInactive) q.status = { $ne: 'inactive' };
    const all = await Category.find(q).sort({ sortOrder: 1, name: 1 }).lean();
    const byParent = new Map();
    for (const c of all) {
      const key = String(c.parentId || 'root');
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(c);
    }
    const attach = (cat) => {
      const children = byParent.get(String(cat._id)) || [];
      return { ...cat, children: children.map(attach) };
    };
    return (byParent.get('root') || []).map(attach);
  }

  async getById(id) {
    const cat = await Category.findById(id);
    if (!cat) throw notFound('Category not found', 'CATEGORY_NOT_FOUND');
    return cat;
  }

  async remove({ id, actorId = null, req = null }) {
    const cat = await this.getById(id);
    const children = await Category.countDocuments({ parentId: id, isDeleted: { $ne: true } });
    if (children > 0) {
      throw badRequest('Cannot delete a category that has children', 'CATEGORY_HAS_CHILDREN');
    }
    await cat.softDelete();
    await auditService.record({
      action: 'delete', entityType: 'category', entityId: cat.id,
      actorId, actorType: 'admin', before: { name: cat.name }, req,
    });
    await catalogEventService.publish({
      eventType: 'category_updated', entityType: 'category', entityId: cat.id,
      payload: { id: cat.id, name: cat.name, status: 'inactive' },
    });
    return { deleted: true };
  }

  /**
   * Validate EAV attributes against the category's attributeSchema
   * (compliance gating: food/pharma categories can require FSSAI, expiry, etc.).
   */
  async validateAttributes(categoryId, attributes = []) {
    const cat = await this.getById(categoryId);
    const schema = cat.attributeSchema || [];
    if (schema.length === 0) return { ok: true, errors: [] };

    const byKey = new Map((attributes || []).map((a) => [a.key, a]));
    const errors = [];

    for (const field of schema) {
      const entry = byKey.get(field.key);
      if (field.required && !entry) {
        errors.push(`${field.label || field.key} is required for category "${cat.name}"`);
        continue;
      }
      if (!entry) continue;

      const value = String(entry.value ?? '');
      if (field.type === ATTRIBUTE_FIELD_TYPE.NUMBER) {
        const n = Number(value);
        if (Number.isNaN(n)) { errors.push(`${field.key} must be a number`); continue; }
        if (field.min !== null && field.min !== undefined && n < field.min) errors.push(`${field.key} must be >= ${field.min}`);
        if (field.max !== null && field.max !== undefined && n > field.max) errors.push(`${field.key} must be <= ${field.max}`);
      } else if (field.type === ATTRIBUTE_FIELD_TYPE.SELECT) {
        if (field.options?.length && !field.options.includes(value)) {
          errors.push(`${field.key} must be one of: ${field.options.join(', ')}`);
        }
      } else if (field.type === ATTRIBUTE_FIELD_TYPE.BOOLEAN) {
        if (!['true', 'false'].includes(value.toLowerCase())) errors.push(`${field.key} must be true/false`);
      }
      if (field.regex) {
        try {
          if (!new RegExp(field.regex).test(value)) errors.push(`${field.key} failed format validation`);
        } catch { /* ignore invalid regex in schema */ }
      }
    }
    return { ok: errors.length === 0, errors };
  }
}

export default new CategoryService();
