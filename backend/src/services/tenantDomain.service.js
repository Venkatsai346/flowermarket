import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import TenantDomain from '../models/tenantDomain.model.js';
import Tenant from '../models/tenant.model.js';
import auditService from './audit.service.js';
import config from '../config/index.js';
import { badRequest, conflict, notFound } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';
import { classifyHost, normalizeHost, storefrontUrl } from '../utils/hostname.js';
import {
  DOMAIN_KIND, DOMAIN_VERIFICATION_STATUS, TLS_STATUS,
  TENANT_RESOLUTION_SOURCE, AUDIT_ACTION,
} from '../constants/enums.js';

/**
 * TenantDomainService — hostname → tenant (Phase 6.4).
 *
 * This runs on EVERY request, so it is built around a small process-local
 * cache; a miss costs one indexed `findOne`. Measured target: well under
 * 0.5 ms p99 added latency.
 *
 * ── The rule that prevents a cross-tenant leak ──────────────────────────────
 * An unknown subdomain of the platform root domain resolves to NOTHING. It
 * must never fall back to the default tenant: `notastore.flowermarket.in`
 * quietly serving the default store's catalogue is a data leak with a friendly
 * face. Hosts that are not under our root domain (localhost, the sandbox
 * preview host, an IP) are classified as infrastructure and simply do not
 * participate in host-based resolution, which is what keeps every existing
 * header-based client working unchanged.
 */

/** Tiny TTL+LRU cache. Negative results are cached too — that is the whole point. */
class HostCache {
  constructor({ max = 2000, ttlMs = 300000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) { this.misses += 1; return undefined; }
    if (Date.now() - hit.at > this.ttlMs) { this.map.delete(key); this.misses += 1; return undefined; }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, hit);
    this.hits += 1;
    return hit.value;
  }

  set(key, value) {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, at: Date.now() });
  }

  delete(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
  get stats() {
    const total = this.hits + this.misses;
    return { size: this.map.size, hits: this.hits, misses: this.misses, hitRate: total ? this.hits / total : 0 };
  }
}

class TenantDomainService {
  constructor() {
    this.cache = new HostCache({ ttlMs: config.domains.cacheTtlMs });
  }

  /**
   * Resolve a raw Host header to `{ tenantId, source, slug, hostname }`, or
   * null when the host does not identify a store.
   *
   * Throws `404 STORE_NOT_FOUND` for a well-formed but unknown store
   * subdomain — deliberately louder than returning null, because that case is
   * a typo or an attack, never a legitimate fallback.
   */
  async resolveByHost(rawHost) {
    const cls = classifyHost(rawHost, {
      rootDomain: config.domains.rootDomain,
      reservedSlugs: config.marketplace.reservedSlugs,
    });

    // localhost, IPs, the apex and reserved subdomains never carry a store
    if (cls.kind === 'infrastructure' || cls.kind === 'apex' || cls.kind === 'reserved') return null;

    const cacheKey = cls.host;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      if (cached === null && cls.kind === 'store_subdomain') {
        throw notFound(`No store at ${cls.host}`, 'STORE_NOT_FOUND');
      }
      return cached;
    }

    let resolved = null;

    if (cls.kind === 'store_subdomain') {
      const tenant = await Tenant.findOne({ slug: cls.slug, status: 'active' }).select('_id slug').lean();
      resolved = tenant
        ? { tenantId: tenant._id, slug: tenant.slug, hostname: cls.host, source: TENANT_RESOLUTION_SOURCE.HOST_SUBDOMAIN }
        : null;
    } else if (cls.kind === 'custom') {
      const domain = await TenantDomain.findOne({
        hostname: cls.host,
        status: 'active',
        'verification.status': DOMAIN_VERIFICATION_STATUS.VERIFIED,
      }).select('tenantId hostname').lean();
      if (domain) {
        const tenant = await Tenant.findById(domain.tenantId).select('_id slug status').lean();
        resolved = tenant && tenant.status === 'active'
          ? { tenantId: tenant._id, slug: tenant.slug, hostname: cls.host, source: TENANT_RESOLUTION_SOURCE.HOST_CUSTOM }
          : null;
      }
    }

    this.cache.set(cacheKey, resolved);

    // A valid-looking store subdomain that matches no store is an error, not a
    // silent fallback to whichever tenant happens to be default.
    if (!resolved && cls.kind === 'store_subdomain') {
      throw notFound(`No store at ${cls.host}`, 'STORE_NOT_FOUND');
    }
    return resolved;
  }

  /** Drop cached entries — called on any domain or tenant-slug change. */
  invalidate(hostname = null) {
    if (hostname) this.cache.delete(normalizeHost(hostname));
    else this.cache.clear();
  }

  invalidateTenant(slug) {
    if (slug && config.domains.rootDomain) {
      this.cache.delete(`${String(slug).toLowerCase()}.${config.domains.rootDomain.toLowerCase()}`);
    }
  }

  get cacheStats() { return this.cache.stats; }

  // -------------------------------------------------------------------------
  // management
  // -------------------------------------------------------------------------

  async list({ tenantId }) {
    const rows = await TenantDomain.find({ tenantId }).sort({ isPrimary: -1, createdAt: 1 }).lean();
    return {
      items: serializeList(rows).map((d) => ({
        ...d,
        dnsRecord: d.kind === DOMAIN_KIND.CUSTOM
          ? { type: 'TXT', name: `_fm-verify.${d.hostname}`, value: d.verification?.token }
          : null,
      })),
    };
  }

  /**
   * Claim a custom domain. Creates the row PENDING with a verification token —
   * it resolves to nothing until DNS proves ownership.
   */
  async add({ tenantId, hostname, actorId = null, req = null }) {
    const host = normalizeHost(hostname);
    if (!host) throw badRequest('That is not a valid hostname', 'BAD_HOSTNAME');

    const cls = classifyHost(host, {
      rootDomain: config.domains.rootDomain,
      reservedSlugs: config.marketplace.reservedSlugs,
    });
    if (cls.kind === 'infrastructure') throw badRequest('That hostname cannot be used', 'BAD_HOSTNAME');
    if (cls.kind === 'apex') throw conflict('The platform apex domain cannot be claimed', 'HOSTNAME_RESERVED');
    if (cls.kind === 'reserved') throw conflict(`"${cls.slug}" is a reserved subdomain`, 'HOSTNAME_RESERVED');
    if (cls.kind === 'store_subdomain') {
      throw conflict(
        'Platform subdomains are managed automatically — publish your store to get one',
        'HOSTNAME_MANAGED'
      );
    }

    const existing = await TenantDomain.findOne({ hostname: host }).lean();
    if (existing) {
      throw conflict(
        String(existing.tenantId) === String(tenantId)
          ? 'You have already added this domain'
          : 'That domain is already claimed',
        'HOSTNAME_TAKEN'
      );
    }

    const doc = await TenantDomain.create({
      tenantId,
      hostname: host,
      kind: DOMAIN_KIND.CUSTOM,
      verification: {
        method: 'dns_txt',
        token: `fm-verify-${crypto.randomBytes(16).toString('hex')}`,
        status: DOMAIN_VERIFICATION_STATUS.PENDING,
      },
      tls: { status: TLS_STATUS.NONE },
      addedBy: actorId,
    });

    await auditService.record({
      action: AUDIT_ACTION.DOMAIN_ADD, entityType: 'tenant_domain', entityId: doc._id,
      tenantId, actorId, actorType: 'tenant', after: { hostname: host }, req,
    }).catch(() => {});

    return {
      domain: doc,
      dnsRecord: { type: 'TXT', name: `_fm-verify.${host}`, value: doc.verification.token },
    };
  }

  /**
   * Check the DNS TXT record. Only on success does the hostname start
   * resolving — and only then is it eligible for a certificate.
   */
  async verify({ tenantId, domainId, req = null, actorId = null }) {
    const doc = await TenantDomain.findOne({ _id: domainId, tenantId });
    if (!doc) throw notFound('Domain not found', 'DOMAIN_NOT_FOUND');
    if (doc.verification.status === DOMAIN_VERIFICATION_STATUS.VERIFIED) {
      return { domain: doc, alreadyVerified: true };
    }

    doc.verification.attempts += 1;
    doc.verification.lastCheckedAt = new Date();

    let records = [];
    try {
      records = await dns.resolveTxt(`_fm-verify.${doc.hostname}`);
    } catch (err) {
      doc.verification.status = DOMAIN_VERIFICATION_STATUS.FAILED;
      doc.verification.lastError = `DNS lookup failed: ${err.code || err.message}`;
      await doc.save();
      return { domain: doc, verified: false, error: doc.verification.lastError };
    }

    const flat = records.map((chunks) => chunks.join('').trim());
    if (!flat.includes(doc.verification.token)) {
      doc.verification.status = DOMAIN_VERIFICATION_STATUS.FAILED;
      doc.verification.lastError = 'TXT record found but the value does not match';
      await doc.save();
      return { domain: doc, verified: false, error: doc.verification.lastError, found: flat };
    }

    doc.verification.status = DOMAIN_VERIFICATION_STATUS.VERIFIED;
    doc.verification.verifiedAt = new Date();
    doc.verification.lastError = null;
    doc.tls.status = TLS_STATUS.PROVISIONING; // on-demand TLS takes it from here
    await doc.save();
    this.invalidate(doc.hostname);

    await auditService.record({
      action: AUDIT_ACTION.DOMAIN_VERIFY, entityType: 'tenant_domain', entityId: doc._id,
      tenantId, actorId, actorType: 'tenant', after: { hostname: doc.hostname, verified: true }, req,
    }).catch(() => {});

    return { domain: doc, verified: true };
  }

  async setPrimary({ tenantId, domainId, actorId = null, req = null }) {
    const doc = await TenantDomain.findOne({ _id: domainId, tenantId });
    if (!doc) throw notFound('Domain not found', 'DOMAIN_NOT_FOUND');
    if (!doc.isLive()) throw conflict('Verify the domain before making it primary', 'DOMAIN_NOT_VERIFIED');

    await TenantDomain.updateMany({ tenantId, isPrimary: true }, { $set: { isPrimary: false } });
    doc.isPrimary = true;
    await doc.save();
    this.invalidate();

    await auditService.record({
      action: AUDIT_ACTION.DOMAIN_PRIMARY, entityType: 'tenant_domain', entityId: doc._id,
      tenantId, actorId, actorType: 'tenant', after: { hostname: doc.hostname }, req,
    }).catch(() => {});
    return doc;
  }

  async remove({ tenantId, domainId, actorId = null, req = null }) {
    const doc = await TenantDomain.findOne({ _id: domainId, tenantId });
    if (!doc) throw notFound('Domain not found', 'DOMAIN_NOT_FOUND');
    if (doc.kind === DOMAIN_KIND.SUBDOMAIN) {
      throw conflict('Platform subdomains cannot be removed', 'HOSTNAME_MANAGED');
    }
    const hostname = doc.hostname;
    await TenantDomain.deleteOne({ _id: doc._id });
    this.invalidate(hostname);

    await auditService.record({
      action: AUDIT_ACTION.DOMAIN_REMOVE, entityType: 'tenant_domain', entityId: doc._id,
      tenantId, actorId, actorType: 'tenant', after: { hostname }, req,
    }).catch(() => {});
    return { removed: true, hostname };
  }

  /**
   * The on-demand-TLS `ask` hook. A certificate authority will issue a cert for
   * ANY hostname we say yes to, so this is a security boundary: only verified,
   * active domains (and our own subdomains, which the wildcard already covers)
   * are allowed.
   */
  async isAllowedForTls(rawHost) {
    const host = normalizeHost(rawHost);
    if (!host) return false;
    const cls = classifyHost(host, {
      rootDomain: config.domains.rootDomain,
      reservedSlugs: config.marketplace.reservedSlugs,
    });
    if (cls.kind === 'store_subdomain') {
      return Boolean(await Tenant.exists({ slug: cls.slug, status: 'active' }));
    }
    if (cls.kind !== 'custom') return false;
    return Boolean(await TenantDomain.exists({
      hostname: host,
      status: 'active',
      'verification.status': DOMAIN_VERIFICATION_STATUS.VERIFIED,
    }));
  }

  /** Canonical hostname for a tenant: its primary custom domain, else the subdomain. */
  async canonicalHostFor({ tenantId, slug = null }) {
    const primary = await TenantDomain.findOne({
      tenantId, isPrimary: true, status: 'active',
      'verification.status': DOMAIN_VERIFICATION_STATUS.VERIFIED,
    }).select('hostname').lean();
    if (primary) return primary.hostname;
    const s = slug || (await Tenant.findById(tenantId).select('slug').lean())?.slug;
    return s && config.domains.rootDomain ? `${s}.${config.domains.rootDomain}` : null;
  }

  /** Every hostname that should be accepted as a CORS origin. */
  async liveHostnames() {
    const rows = await TenantDomain.find({
      status: 'active', 'verification.status': DOMAIN_VERIFICATION_STATUS.VERIFIED,
    }).select('hostname').lean();
    return rows.map((r) => r.hostname);
  }

  storefrontUrlFor(slug) {
    return storefrontUrl(slug, config.domains.rootDomain, {
      protocol: config.isDev ? 'http' : 'https',
    });
  }
}

export default new TenantDomainService();
