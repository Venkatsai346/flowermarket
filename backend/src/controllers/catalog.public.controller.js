import catalogSearchService from '../services/catalogSearch.service.js';
import searchService from '../services/search.service.js';
import config from '../config/index.js';
import productMasterService from '../services/productMaster.service.js';
import inventoryService from '../services/inventory.service.js';
import slotService from '../services/slot.service.js';
import tenantDomainService from '../services/tenantDomain.service.js';
import ProductMaster from '../models/productMaster.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';
import { notFound, badRequest } from '../utils/ApiError.js';
import { PRODUCT_MASTER_STATUS, TENANT_LISTING_STATUS } from '../constants/enums.js';
import { localityFromPincode } from '../utils/indiaPin.js';

const SITEMAP_LIMIT = 2000;

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoDay(d) {
  const dt = d instanceof Date ? d : new Date(d || Date.now());
  if (Number.isNaN(dt.getTime())) return new Date().toISOString().slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

const OBJECT_ID_RX = /^[0-9a-fA-F]{24}$/;

/**
 * CatalogPublicController — customer-facing read endpoints.
 * Only ACTIVE tenant listings of ACTIVE masters surface (merged view).
 */
class CatalogPublicController {
  /**
   * GET /catalog — search/browse for the customer app.
   *
   * Phase 6.5: served from the RANKED index when enabled. The response shape is
   * unchanged (items + meta), with `query`, `facets` and `profile` added — so
   * the storefront and mobile clients keep working untouched while gaining
   * relevance, facets, typo tolerance and synonyms.
   *
   * If the ranked path throws for any reason we fall back to the legacy scan
   * rather than failing the request: a degraded catalogue beats no catalogue.
   */
  search = asyncHandler(async (req, res) => {
    const resolvedTenantId = req.tenantId || req.headers['x-tenant-id'];
    const query = {
      ...req.query,
      search: req.query.search || req.query.q || undefined,
    };
    if (config.search.rankedCatalog) {
      try {
        const ranked = await searchService.search({
          tenantId: resolvedTenantId,
          query,
          sessionKey: req.get('x-session-id') || req.ip || null,
        });
        // The index must never shadow a live catalogue. The ranked path
        // cannot tell "no products exist" from "the index has not caught
        // up" — an EMPTY index (fresh store, pre-first-drain) or a PARTIAL
        // one (an event handler failed mid-drain) both serve fewer listings
        // than actually exist. Probe the legacy scan with the same query:
        // if the live catalogue is larger than the index, serve it instead.
        const legacyProbe = await catalogSearchService.search({ tenantId: req.tenantId, query });
        if (legacyProbe.meta.total > (ranked.meta?.total ?? 0)) {
          // eslint-disable-next-line no-console
          console.warn(`[search] index stale — ranked ${ranked.meta?.total} < live ${legacyProbe.meta.total} listings; serving legacy scan`);
          return res.status(200).json(success(legacyProbe.items, {
            message: 'Catalog fetched',
            meta: { ...legacyProbe.meta, indexState: 'stale_fallback' },
          }));
        }
        return res.status(200).json(success(ranked.items, {
          meta: { ...ranked.meta, query: ranked.query, facets: ranked.facets, profile: ranked.profile },
          message: 'Catalog fetched',
        }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[search] ranked path failed, falling back to the legacy scan:', err.message);
      }
    }
    const result = await catalogSearchService.search({ tenantId: resolvedTenantId, query });
    res.status(200).json(success(result.items, { message: 'Catalog fetched', meta: result.meta }));
  });

  /** GET /catalog/categories — active category tree for navigation. */
  categories = asyncHandler(async (req, res) => {
    const tree = await catalogSearchService.customerCategories();
    res.status(200).json(success(tree, { message: 'Categories fetched' }));
  });

  /** GET /catalog/brands — verified brands for filter chips. */
  brands = asyncHandler(async (req, res) => {
    const brands = await catalogSearchService.customerBrands();
    res.status(200).json(success(brands, { message: 'Brands fetched' }));
  });

  /**
   * Assemble the shareable PDP payload: master (images + EAV) + this store's
   * listing + related listings in the same category.
   */
  async assembleProductPage({ tenantId, masterId }) {
    const TenantProduct = (await import('../models/tenantProduct.model.js')).default;
    const [master, listing] = await Promise.all([
      productMasterService.getMaster(masterId),
      TenantProduct.findOne({ tenantId, productMasterId: masterId, status: 'active' }).lean(),
    ]);
    if (!listing) throw notFound('Product not available in your area', 'PRODUCT_NOT_AVAILABLE');

    const stockMap = await inventoryService.getStock({ tenantId, listingId: listing._id });
    const stockQty = stockMap?.qtyAvailable ?? listing.stockQty ?? 0;

    const relatedRaw = await catalogSearchService.search({
      tenantId,
      query: {
        categoryId: master.categoryId ? String(master.categoryId) : undefined,
        limit: 9,
      },
    });
    const related = (relatedRaw.items || [])
      .filter((r) => String(r.listingId) !== String(listing._id))
      .slice(0, 8);

    const images = (master.images || []).map((img) => ({
      url: img.url,
      altText: img.altText || master.title,
      isPrimary: Boolean(img.isPrimary),
    }));
    const imageUrl = images.find((i) => i.isPrimary)?.url || images[0]?.url || null;

    return {
      product: {
        ...master,
        imageUrl,
        images,
      },
      listing: {
        id: listing._id,
        listingId: String(listing._id),
        price: listing.price,
        status: listing.status,
        orderLimits: listing.orderLimits,
        stockQty,
        availability: {
          status: stockQty > 0 ? 'in_stock' : 'out_of_stock',
          qtyAvailable: stockQty,
        },
      },
      related,
    };
  }

  /** GET /catalog/products/:id — one merged product (tenant context). */
  productDetail = asyncHandler(async (req, res) => {
    const page = await this.assembleProductPage({ tenantId: req.tenantId, masterId: req.params.id });
    res.status(200).json(success(page, { message: 'Product fetched' }));
  });

  /**
   * GET /catalog/p/:slug — shareable PDP. Accepts a master slug, and as a
   * fallback a 24-char ObjectId so cards that only have an id still work
   * before the search index has been reindexed with slugs.
   */
  productBySlug = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    let master = null;
    if (OBJECT_ID_RX.test(slug)) {
      master = await ProductMaster.findOne({
        _id: slug,
        status: PRODUCT_MASTER_STATUS.ACTIVE,
        isDeleted: { $ne: true },
      }).lean();
    }
    if (!master) {
      master = await ProductMaster.findOne({
        slug,
        status: PRODUCT_MASTER_STATUS.ACTIVE,
        isDeleted: { $ne: true },
      }).lean();
    }
    if (!master) throw notFound('Product not found', 'PRODUCT_NOT_FOUND');
    const page = await this.assembleProductPage({ tenantId: req.tenantId, masterId: master._id });
    res.status(200).json(success(page, { message: 'Product fetched' }));
  });

  /** GET /catalog/serviceability?pincode= — the front door. Public, no auth. */
  serviceability = asyncHandler(async (req, res) => {
    const pincode = String(req.query.pincode || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(pincode)) throw badRequest('Enter a 6-digit pincode', 'BAD_PINCODE');
    const locality = localityFromPincode(pincode);
    try {
      const hub = await slotService.resolveHub({ tenantId: req.tenantId, pincode });
      const city = hub.name || locality.city;
      res.status(200).json(success({
        pincode,
        serviceable: true,
        hub: { id: hub.id || hub._id, name: hub.name },
        locality: { city, state: locality.state, region: locality.region },
      }, { message: 'We deliver here' }));
    } catch (err) {
      if (err?.code === 'PINCODE_UNSERVICEABLE' || err?.code === 'HUB_NOT_FOUND') {
        return res.status(200).json(success({
          pincode, serviceable: false, hub: null, locality,
        }, { message: err.message || "We don't deliver there yet" }));
      }
      throw err;
    }
  });

  /**
   * GET /catalog/sitemap.xml — host-tenant product URLs for crawlers.
   * Raw XML (not the JSON envelope). Public; tenant comes from Host.
   */
  sitemap = asyncHandler(async (req, res) => {
    const canonical = await tenantDomainService.canonicalHostFor({
      tenantId: req.tenantId,
      slug: req.tenant?.slug,
    });
    const host = canonical || req.tenantHost || req.get('host') || '';
    const proto = /localhost|127\.0\.0\.1/.test(host) ? 'http' : 'https';
    const origin = host ? `${proto}://${host}` : '';

    const listings = await TenantProduct.find({
      tenantId: req.tenantId,
      status: TENANT_LISTING_STATUS.ACTIVE,
      isDeleted: { $ne: true },
    }).select('productMasterId updatedAt').limit(SITEMAP_LIMIT).lean();

    const masters = await ProductMaster.find({
      _id: { $in: listings.map((l) => l.productMasterId) },
      status: PRODUCT_MASTER_STATUS.ACTIVE,
      isDeleted: { $ne: true },
      slug: { $exists: true, $nin: [null, ''] },
    }).select('slug updatedAt').lean();
    const byId = new Map(masters.map((m) => [String(m._id), m]));

    const urls = [
      { loc: `${origin}/`, lastmod: isoDay(), changefreq: 'daily', priority: '1.0' },
    ];
    for (const listing of listings) {
      const master = byId.get(String(listing.productMasterId));
      if (!master?.slug) continue;
      urls.push({
        loc: `${origin}/p/${encodeURIComponent(master.slug)}`,
        lastmod: isoDay(listing.updatedAt || master.updatedAt),
        changefreq: 'weekly',
        priority: '0.8',
      });
    }

    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((u) => (
        `  <url><loc>${xmlEscape(u.loc)}</loc><lastmod>${u.lastmod}</lastmod>`
        + `<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
      )),
      '</urlset>',
      '',
    ].join('\n');

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).send(body);
  });

  /** GET /catalog/products/:id/stock — quick availability check (RN app polling). */
  stockCheck = asyncHandler(async (req, res) => {
    const TenantProduct = (await import('../models/tenantProduct.model.js')).default;
    const listing = await TenantProduct.findOne({ tenantId: req.tenantId, productMasterId: req.params.id, status: 'active' }).lean();
    if (!listing) throw notFound('Product not available in your area', 'PRODUCT_NOT_AVAILABLE');
    const stock = await inventoryService.getStock({ tenantId: req.tenantId, listingId: listing._id });
    res.status(200).json(success(stock, { message: 'Stock fetched' }));
  });
}

export default new CatalogPublicController();
