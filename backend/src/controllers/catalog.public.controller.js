import catalogSearchService from '../services/catalogSearch.service.js';
import searchService from '../services/search.service.js';
import config from '../config/index.js';
import productMasterService from '../services/productMaster.service.js';
import inventoryService from '../services/inventory.service.js';
import slotService from '../services/slot.service.js';
import ProductMaster from '../models/productMaster.model.js';
import TenantProduct from '../models/tenantProduct.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';
import { notFound, badRequest } from '../utils/ApiError.js';
import { pickDefaultVariant, variantDisplayLabel } from '../utils/catalog/variantImages.js';
import { PRODUCT_MASTER_STATUS } from '../constants/enums.js';

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
   *
   * `?groupBy=master` collapses the page into ONE card per master with the full
   * listed-variant family (storefront dropdown cards). Grouping is order-
   * preserving, so ranked relevance survives it; pagination stays listing-based.
   */
  search = asyncHandler(async (req, res) => {
    const resolvedTenantId = req.tenantId || req.headers['x-tenant-id'];
    const query = {
      ...req.query,
      search: req.query.search || req.query.q || undefined,
    };
    const grouped = query.groupBy === 'master';
    const maybeGroup = async (items, meta) => {
      if (!grouped) return { items, meta };
      const cards = await catalogSearchService.groupListingRows({ tenantId: resolvedTenantId, rows: items });
      return { items: cards, meta: { ...meta, grouped: true, groupedCount: cards.length } };
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
          const g = await maybeGroup(legacyProbe.items, legacyProbe.meta);
          return res.status(200).json(success(g.items, {
            message: 'Catalog fetched',
            meta: { ...g.meta, indexState: 'stale_fallback' },
          }));
        }
        const g = await maybeGroup(ranked.items, ranked.meta);
        return res.status(200).json(success(g.items, {
          meta: { ...g.meta, query: ranked.query, facets: ranked.facets, profile: ranked.profile },
          message: 'Catalog fetched',
        }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[search] ranked path failed, falling back to the legacy scan:', err.message);
      }
    }
    const result = await catalogSearchService.search({ tenantId: resolvedTenantId, query });
    const g = await maybeGroup(result.items, result.meta);
    res.status(200).json(success(g.items, { message: 'Catalog fetched', meta: g.meta }));
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
   * GET /catalog/store/brands — brands mapped to THIS tenant's live listings,
   * with per-brand product counts + from-prices. The storefront brands page
   * source (tenant resolved from host/header by tenantContext).
   */
  storeBrands = asyncHandler(async (req, res) => {
    const brands = await catalogSearchService.storefrontBrands({ tenantId: req.tenantId });
    res.status(200).json(success(brands, {
      message: 'Store brands fetched',
      meta: { total: brands.length },
    }));
  });

  /**
   * GET /catalog/store/categories — categories mapped to THIS tenant's live
   * listings, as a pruned tree (subtree totals rolled up) + flat lookup.
   * The storefront categories page + browse-header source.
   */
  storeCategories = asyncHandler(async (req, res) => {
    const result = await catalogSearchService.storefrontCategories({ tenantId: req.tenantId });
    res.status(200).json(success(result, {
      message: 'Store categories fetched',
      meta: { total: result.flat.length },
    }));
  });

  /**
   * Assemble the shareable PDP payload: master (images + EAV) + this store's
   * listing + the FULL listed-variant family + related listings.
   *
   * `variantId` (from `?variantId=`) selects the variant; an unknown, unlisted
   * or inactive variant falls back to the default (isDefault-listed, then
   * first in-stock, then first) — a stale deep link never 404s when the
   * product itself is sellable. The gallery resolves per selected variant with
   * master fallback, and `imageSource` says which one served.
   */
  async assembleProductPage({ tenantId, masterId, variantId = null }) {
    const [master, listings] = await Promise.all([
      productMasterService.getMaster(masterId),
      TenantProduct.find({ tenantId, productMasterId: masterId, status: 'active' }).lean(),
    ]);
    if (!listings?.length) throw notFound('Product not available in your area', 'PRODUCT_NOT_AVAILABLE');

    const variantById = new Map((master.variants || []).map((v) => [String(v._id ?? v.id), v]));
    // Drop listings whose variant was deactivated after listing (never offer dead SKUs).
    const live = listings.filter((l) => !l.variantId || variantById.has(String(l.variantId)));
    if (!live.length) throw notFound('Product not available in your area', 'PRODUCT_NOT_AVAILABLE');

    // Variant rows win over a legacy master-level row when both exist.
    const variantRows = live.filter((l) => l.variantId);
    const family = variantRows.length ? variantRows : live;

    const stockByListing = {};
    await Promise.all(family.map(async (l) => {
      try {
        const s = await inventoryService.getStock({ tenantId, listingId: l._id });
        stockByListing[String(l._id)] = s?.qtyAvailable ?? l.stockQty ?? 0;
      } catch {
        stockByListing[String(l._id)] = l.stockQty ?? 0;
      }
    }));

    const variants = family.map((l) => {
      const v = l.variantId ? variantById.get(String(l.variantId)) : null;
      const gallery = v?.images?.length ? v.images : (master.images || []).map((img) => ({
        id: img._id ?? img.id, url: img.url, altText: img.altText || master.title,
        isPrimary: Boolean(img.isPrimary), sortOrder: img.sortOrder ?? 0,
      }));
      const stockQty = stockByListing[String(l._id)] ?? 0;
      return {
        listingId: String(l._id),
        variantId: l.variantId ? String(l.variantId) : null,
        variantType: v?.variantType || null,
        value: v?.value || null,
        label: v ? variantDisplayLabel(v) : null,
        sku: v?.sku || null,
        sortOrder: v?.sortOrder ?? 0,
        isDefault: Boolean(v?.isDefault),
        price: l.price,
        orderLimits: l.orderLimits,
        stockQty,
        availability: { status: stockQty > 0 ? 'in_stock' : 'out_of_stock', qtyAvailable: stockQty },
        imageUrl: gallery[0]?.url || null,
        imageSource: v?.images?.length ? 'variant' : 'master',
        images: gallery,
      };
    }).sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.label || '').localeCompare(String(b.label || '')));

    let selected = variantId ? variants.find((v) => v.variantId === String(variantId)) : null;
    if (!selected) {
      const def = pickDefaultVariant(variants.map((v) => ({
        variant: { isDefault: v.isDefault, sortOrder: v.sortOrder, value: v.value },
        stockQty: v.stockQty,
      })));
      selected = (def && variants.find((v) => v.isDefault === def.variant?.isDefault && v.sortOrder === def.variant?.sortOrder && v.value === def.variant?.value))
        || variants.find((v) => v.isDefault) || variants.find((v) => v.stockQty > 0) || variants[0];
    }

    const relatedRaw = await catalogSearchService.search({
      tenantId,
      query: {
        categoryId: master.categoryId ? String(master.categoryId) : undefined,
        limit: 9,
      },
    });
    const familyIds = new Set(family.map((l) => String(l._id)));
    const related = (relatedRaw.items || [])
      .filter((r) => !familyIds.has(String(r.listingId)))
      .slice(0, 8);

    const images = (selected.images || []).map((img) => ({
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
        imageSource: selected.imageSource,
      },
      listing: {
        id: selected.listingId,
        listingId: selected.listingId,
        variantId: selected.variantId,
        price: selected.price,
        status: 'active',
        orderLimits: selected.orderLimits,
        stockQty: selected.stockQty,
        availability: selected.availability,
      },
      selectedVariantId: selected.variantId,
      variants,
      related,
    };
  }

  /** GET /catalog/products/:id — one merged product (tenant context). */
  productDetail = asyncHandler(async (req, res) => {
    const page = await this.assembleProductPage({ tenantId: req.tenantId, masterId: req.params.id, variantId: req.query.variantId || null });
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
    const page = await this.assembleProductPage({ tenantId: req.tenantId, masterId: master._id, variantId: req.query.variantId || null });
    res.status(200).json(success(page, { message: 'Product fetched' }));
  });

  /** GET /catalog/serviceability?pincode= — the front door. Public, no auth. */
  serviceability = asyncHandler(async (req, res) => {
    const pincode = String(req.query.pincode || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(pincode)) throw badRequest('Enter a 6-digit pincode', 'BAD_PINCODE');
    try {
      const hub = await slotService.resolveHub({ tenantId: req.tenantId, pincode });
      res.status(200).json(success({
        pincode, serviceable: true, hub: { id: hub.id || hub._id, name: hub.name },
      }, { message: 'We deliver here' }));
    } catch (err) {
      if (err?.code === 'PINCODE_UNSERVICEABLE' || err?.code === 'HUB_NOT_FOUND') {
        return res.status(200).json(success({
          pincode, serviceable: false, hub: null,
        }, { message: err.message || "We don't deliver there yet" }));
      }
      throw err;
    }
  });

  /** GET /catalog/products/:id/stock[?variantId=] — quick availability check (RN app polling). */
  stockCheck = asyncHandler(async (req, res) => {
    const q = { tenantId: req.tenantId, productMasterId: req.params.id, status: 'active' };
    if (req.query.variantId) q.variantId = req.query.variantId;
    const listing = await TenantProduct.findOne(q).lean();
    if (!listing) throw notFound('Product not available in your area', 'PRODUCT_NOT_AVAILABLE');
    const stock = await inventoryService.getStock({ tenantId: req.tenantId, listingId: listing._id });
    res.status(200).json(success({ ...stock, listingId: String(listing._id), variantId: listing.variantId ? String(listing.variantId) : null }, { message: 'Stock fetched' }));
  });
}

export default new CatalogPublicController();
