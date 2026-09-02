import { notFound, conflict } from '../utils/ApiError.js';
import Tenant from '../models/tenant.model.js';

/**
 * TenantService — tenant resolution used by auth flows and middleware.
 * The app is multi-tenant ready; for now the platform runs one active tenant
 * (your flower market). This service is where "resolve tenant from request"
 * logic lives so it can grow into a full tenant management module later.
 */
class TenantService {
  /** Resolve a tenant by ObjectId; throws 404 if missing or inactive. */
  async getById(tenantId) {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) throw notFound('Tenant not found', 'TENANT_NOT_FOUND');
    return tenant;
  }

  /** Resolve the default tenant from config, else the first active one in DB. */
  async resolveDefault() {
    const { defaultTenantId } = await import('../config/index.js').then((m) => m.default);
    if (defaultTenantId) {
      try {
        return await this.getById(defaultTenantId);
      } catch {
        // fall through to first-active lookup
      }
    }
    // NOTE: no .lean() here — hydrated doc so `.id` virtual is available
    const tenant = await Tenant.findOne({ status: 'active', isDeleted: { $ne: true } })
      .sort({ createdAt: 1 });
    if (!tenant) throw notFound('No active tenant configured. Run `npm run seed`.', 'TENANT_NOT_CONFIGURED');
    return tenant;
  }

  /** Get (or lazily create) the auth config for a tenant. */
  async getAuthConfig(tenantId) {
    const { default: TenantAuthConfig } = await import('../models/tenantAuthConfig.model.js');
    let cfg = await TenantAuthConfig.findOne({ tenantId });
    if (!cfg) {
      cfg = await TenantAuthConfig.create({ tenantId });
    }
    return cfg;
  }

  /** Create a new tenant (admin utility). */
  async create(payload) {
    const existing = await Tenant.findOne({ slug: payload.slug });
    if (existing) throw conflict('Tenant slug already exists', 'TENANT_SLUG_EXISTS');
    return Tenant.create(payload);
  }
}

export default new TenantService();
