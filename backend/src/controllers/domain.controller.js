import tenantDomainService from '../services/tenantDomain.service.js';
import storeService from '../services/store.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';
import { forbidden } from '../utils/ApiError.js';
import config from '../config/index.js';

class DomainController {
  // ---------------- store owner ----------------
  list = asyncHandler(async (req, res) => {
    const result = await tenantDomainService.list({ tenantId: req.tenantId });
    res.status(200).json(success({
      ...result,
      platformSubdomain: tenantDomainService.storefrontUrlFor(req.tenant?.slug),
    }, { message: 'Domains fetched' }));
  });

  add = asyncHandler(async (req, res) => {
    const result = await tenantDomainService.add({
      tenantId: req.tenantId, hostname: req.body.hostname,
      actorId: req.auth.userId, req,
    });
    res.status(201).json(created(result, {
      message: 'Domain added — publish the DNS record, then verify',
    }));
  });

  verify = asyncHandler(async (req, res) => {
    const result = await tenantDomainService.verify({
      tenantId: req.tenantId, domainId: req.params.id,
      actorId: req.auth.userId, req,
    });
    res.status(200).json(success(result, {
      message: result.verified || result.alreadyVerified
        ? 'Domain verified'
        : `Not verified yet — ${result.error}`,
    }));
  });

  setPrimary = asyncHandler(async (req, res) => {
    const doc = await tenantDomainService.setPrimary({
      tenantId: req.tenantId, domainId: req.params.id, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(doc, { message: 'Primary domain updated' }));
  });

  remove = asyncHandler(async (req, res) => {
    const result = await tenantDomainService.remove({
      tenantId: req.tenantId, domainId: req.params.id, actorId: req.auth.userId, req,
    });
    res.status(200).json(success(result, { message: 'Domain removed' }));
  });

  // ---------------- public storefront bootstrap ----------------
  /**
   * Everything a storefront needs on first paint, resolved from the HOST the
   * browser used. No tenant id in the URL, no header: the hostname is the
   * identity, which is the entire point of this phase.
   */
  bootstrap = asyncHandler(async (req, res) => {
    const tenant = req.tenant;
    const canonicalHost = await tenantDomainService.canonicalHostFor({
      tenantId: req.tenantId, slug: tenant?.slug,
    });
    res.status(200).json(success({
      store: {
        id: String(tenant._id),
        name: tenant.name,
        slug: tenant.slug,
        tagline: tenant.store?.tagline || null,
        description: tenant.store?.description || null,
        logoUrl: tenant.logoUrl || null,
        bannerUrl: tenant.store?.bannerUrl || null,
        socialLinks: tenant.store?.socialLinks || {},
        isPublished: Boolean(tenant.store?.isPublished),
      },
      theme: tenant.theme || {},
      features: tenant.features || {},
      routing: {
        resolvedFrom: req.tenantSource,
        host: req.tenantHost,
        canonicalHost,
        canonicalUrl: canonicalHost ? `${config.isDev ? 'http' : 'https'}://${canonicalHost}` : null,
      },
    }, { message: 'Storefront bootstrapped' }));
  });

  // ---------------- infrastructure ----------------
  /**
   * On-demand TLS `ask` hook. A CA will issue a certificate for ANY hostname
   * we approve, so this must only ever say yes to a verified domain. Answers
   * 200 (allowed) or 404 (not allowed) — the shape Caddy's `ask` expects.
   */
  tlsAllowed = asyncHandler(async (req, res) => {
    const allowlist = config.domains.tlsHookAllowlist;
    if (allowlist.length) {
      const ip = (req.ip || '').replace('::ffff:', '');
      if (!allowlist.includes(ip)) throw forbidden('Not permitted', 'TLS_HOOK_FORBIDDEN');
    }
    const host = req.query.host || req.query.domain;
    const allowed = await tenantDomainService.isAllowedForTls(host);
    if (!allowed) return res.status(404).json({ success: false, message: 'Unknown host', code: 'HOST_NOT_ALLOWED' });
    return res.status(200).json(success({ host, allowed: true }, { message: 'Certificate permitted' }));
  });

  /** Platform-wide domain view + cache health. */
  adminList = asyncHandler(async (req, res) => {
    const { default: TenantDomain } = await import('../models/tenantDomain.model.js');
    const rows = await TenantDomain.find({}).sort({ createdAt: -1 }).limit(200).lean();
    res.status(200).json(success({
      items: rows.map((d) => ({ ...d, id: String(d._id) })),
      cache: tenantDomainService.cacheStats,
      rootDomain: config.domains.rootDomain,
    }, { message: 'Domains fetched' }));
  });
}

export default new DomainController();
