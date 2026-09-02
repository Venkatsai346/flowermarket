import catalogSearchService from '../services/catalogSearch.service.js';
import productMasterService from '../services/productMaster.service.js';
import inventoryService from '../services/inventory.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';
import { notFound } from '../utils/ApiError.js';

/**
 * CatalogPublicController — customer-facing read endpoints.
 * Only ACTIVE tenant listings of ACTIVE masters surface (merged view).
 */
class CatalogPublicController {
  /** GET /catalog — search/browse for the customer app. */
  search = asyncHandler(async (req, res) => {
    const result = await catalogSearchService.search({ tenantId: req.tenantId, query: req.query });
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

  /** GET /catalog/products/:id — one merged product (tenant context). */
  productDetail = asyncHandler(async (req, res) => {
    const { tenantId } = req;
    const { id } = req.params;

    const [master, listing, stockMap] = await Promise.all([
      productMasterService.getMaster(id),
      (async () => {
        const TenantProduct = (await import('../models/tenantProduct.model.js')).default;
        return TenantProduct.findOne({ tenantId, productMasterId: id, status: 'active' }).lean();
      })(),
      (async () => {
        const TenantProduct = (await import('../models/tenantProduct.model.js')).default;
        const lp = await TenantProduct.findOne({ tenantId, productMasterId: id, status: 'active' }).lean();
        return lp ? inventoryService.getStock({ tenantId, listingId: lp._id }) : null;
      })(),
    ]);

    if (!listing) throw notFound('Product not available in your area', 'PRODUCT_NOT_AVAILABLE');

    res.status(200).json(
      success({
        product: master,
        listing: {
          id: listing._id,
          price: listing.price,
          status: listing.status,
          orderLimits: listing.orderLimits,
          availability: stockMap ? { status: stockMap.qtyAvailable > 0 ? 'in_stock' : 'out_of_stock', qtyAvailable: stockMap.qtyAvailable } : listing.availability,
        },
      }, { message: 'Product fetched' })
    );
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
