import Joi from 'joi';
import {
  PRODUCT_TYPE,
  PRODUCT_MASTER_STATUS,
  TENANT_LISTING_STATUS,
  CHANGE_REQUEST_TYPE,
  CHANGE_REQUEST_STATUS,
  AUDIT_ACTION,
  SELLING_UNIT,
  AVAILABILITY_STATUS,
  VARIANT_TYPE,
  ATTRIBUTE_FIELD_TYPE,
} from '../../constants/enums.js';

/**
 * Catalog-domain validation schemas (Joi).
 * Controllers run these through the `validate` middleware.
 */

const objectId = Joi.string().pattern(/^[0-9a-fA-F]{24}$/).messages({
  'string.pattern.base': 'Invalid id',
});
const optionalObjectId = objectId.allow(null, '').empty('').allow(null);

const pagination = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string().default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
};

// ---------------- Category ----------------
const attributeSchemaField = Joi.object({
  key: Joi.string().pattern(/^[a-z0-9_]+$/).required(),
  label: Joi.string().max(80),
  type: Joi.string().valid(...Object.values(ATTRIBUTE_FIELD_TYPE)).default('string'),
  required: Joi.boolean().default(false),
  options: Joi.array().items(Joi.string().max(60)).max(50),
  unit: Joi.string().max(20),
  min: Joi.number(),
  max: Joi.number(),
  regex: Joi.string(),
});

export const categoryCreateSchema = Joi.object({
  name: Joi.string().max(120).required(),
  slug: Joi.string().max(140).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  parentId: optionalObjectId,
  description: Joi.string().max(500).allow(null, ''),
  imageUrl: Joi.string().uri({ allowRelative: true }).allow(null, ''),
  iconUrl: Joi.string().uri({ allowRelative: true }).allow(null, ''),
  attributeSchema: Joi.array().items(attributeSchemaField).max(40),
  sortOrder: Joi.number().integer().min(0).default(0),
  isFeatured: Joi.boolean().default(false),
  status: Joi.string().valid('active', 'inactive', 'archived'),
});

export const categoryUpdateSchema = categoryCreateSchema.fork(['name', 'slug'], (s) => s.optional());

export const categoryQuerySchema = Joi.object({
  includeInactive: Joi.boolean().default(false),
  parentId: optionalObjectId,
  featured: Joi.boolean(),
  ...pagination,
});

// ---------------- Brand ----------------
export const brandCreateSchema = Joi.object({
  name: Joi.string().max(120).required(),
  slug: Joi.string().max(140).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  logoUrl: Joi.string().uri({ allowRelative: true }).allow(null, ''),
  description: Joi.string().max(500).allow(null, ''),
  countryOfOrigin: Joi.string().max(60).allow(null, ''),
  status: Joi.string().valid('active', 'inactive', 'archived'),
});

export const brandUpdateSchema = brandCreateSchema.fork(['name'], (s) => s.optional());

export const brandVerifySchema = Joi.object({
  verified: Joi.boolean().required(),
  note: Joi.string().max(300).allow(null, ''),
});

export const brandQuerySchema = Joi.object({
  status: Joi.string().valid('active', 'inactive', 'archived'),
  verified: Joi.boolean(),
  ...pagination,
});

// ---------------- ProductMaster ----------------
const masterAttributesInput = Joi.array().items(
  Joi.object({
    key: Joi.string().pattern(/^[a-z0-9_]+$/).required(),
    value: Joi.string().max(200).required(),
    unit: Joi.string().max(20),
  })
).max(40);

const masterVariantsInput = Joi.array().items(
  Joi.object({
    variantType: Joi.string().valid(...Object.values(VARIANT_TYPE)).required(),
    value: Joi.string().max(80).required(),
    displayLabel: Joi.string().max(120),
    sku: Joi.string().max(80),
    sortOrder: Joi.number().integer().min(0),
    isDefault: Joi.boolean(),
  })
).max(20);

const masterImagesInput = Joi.array().items(
  Joi.object({
    url: Joi.string().uri({ allowRelative: true }).required(),
    altText: Joi.string().max(200),
    isPrimary: Joi.boolean(),
    sortOrder: Joi.number().integer().min(0),
  })
).max(20);

export const masterCreateSchema = Joi.object({
  skuGlobal: Joi.string().max(80).required(),
  type: Joi.string().valid(...Object.values(PRODUCT_TYPE)).required(),
  title: Joi.string().max(160).required(),
  slug: Joi.string().max(200).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  shortDescription: Joi.string().max(300).allow(null, ''),
  description: Joi.string().max(4000).allow(null, ''),
  categoryId: objectId.required(),
  brandId: optionalObjectId,
  barcode: Joi.string().max(60).allow(null, ''),
  tags: Joi.array().items(Joi.string().max(40)).max(20),
  isPerishable: Joi.boolean(),
  requiresColdChain: Joi.boolean(),
  defaultSellingUnit: Joi.string().valid(...Object.values(SELLING_UNIT)).default(SELLING_UNIT.PIECE),
  minOrderQty: Joi.number().integer().min(1).default(1),
  maxOrderQty: Joi.number().integer().min(1).default(100),
  attributes: masterAttributesInput,
  variants: masterVariantsInput,
  images: masterImagesInput,
  status: Joi.string().valid(...Object.values(PRODUCT_MASTER_STATUS)),
});

export const masterUpdateSchema = Joi.object({
  skuGlobal: Joi.forbidden(),
  type: Joi.forbidden(),
  title: Joi.string().max(160),
  slug: Joi.string().max(200).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  shortDescription: Joi.string().max(300).allow(null, ''),
  description: Joi.string().max(4000).allow(null, ''),
  categoryId: objectId,
  brandId: optionalObjectId,
  barcode: Joi.string().max(60).allow(null, ''),
  tags: Joi.array().items(Joi.string().max(40)).max(20),
  isPerishable: Joi.boolean(),
  requiresColdChain: Joi.boolean(),
  defaultSellingUnit: Joi.string().valid(...Object.values(SELLING_UNIT)),
  minOrderQty: Joi.number().integer().min(1),
  maxOrderQty: Joi.number().integer().min(1),
  expectedVersion: Joi.number().integer().min(1).required(),
}).min(1);

export const masterProposeSchema = Joi.object({
  skuGlobal: Joi.string().max(80).required(),
  type: Joi.string().valid(...Object.values(PRODUCT_TYPE)).required(),
  title: Joi.string().max(160).required(),
  slug: Joi.string().max(200).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  shortDescription: Joi.string().max(300).allow(null, ''),
  description: Joi.string().max(4000).allow(null, ''),
  categoryId: objectId.required(),
  brandId: optionalObjectId,
  barcode: Joi.string().max(60).allow(null, ''),
  tags: Joi.array().items(Joi.string().max(40)).max(20),
  isPerishable: Joi.boolean(),
  requiresColdChain: Joi.boolean(),
  defaultSellingUnit: Joi.string().valid(...Object.values(SELLING_UNIT)).default(SELLING_UNIT.PIECE),
  minOrderQty: Joi.number().integer().min(1).default(1),
  maxOrderQty: Joi.number().integer().min(1).default(100),
  attributes: masterAttributesInput,
  variants: masterVariantsInput,
  images: masterImagesInput,
  note: Joi.string().max(500).allow(null, ''),
});

export const masterQuerySchema = Joi.object({
  status: Joi.string().valid(...Object.values(PRODUCT_MASTER_STATUS)),
  categoryId: optionalObjectId,
  brandId: optionalObjectId,
  type: Joi.string().valid(...Object.values(PRODUCT_TYPE)),
  search: Joi.string().max(120).allow('', null),
  ...pagination,
});

export const variantCreateSchema = Joi.object({
  variantType: Joi.string().valid(...Object.values(VARIANT_TYPE)).required(),
  value: Joi.string().max(80).required(),
  displayLabel: Joi.string().max(120).allow(null, ''),
  sku: Joi.string().max(80).allow(null, ''),
  sortOrder: Joi.number().integer().min(0),
  isDefault: Joi.boolean(),
  expectedVersion: Joi.number().integer().min(1).required(),
});

export const imageCreateSchema = Joi.object({
  url: Joi.string().uri({ allowRelative: true }).required(),
  altText: Joi.string().max(200).allow(null, ''),
  isPrimary: Joi.boolean(),
  sortOrder: Joi.number().integer().min(0),
  expectedVersion: Joi.number().integer().min(1).required(),
});

export const attributeSetSchema = Joi.object({
  attributes: masterAttributesInput.required(),
  expectedVersion: Joi.number().integer().min(1).required(),
});

// ---------------- TenantProduct (listing) ----------------
const priceInput = Joi.object({
  mrp: Joi.number().min(0).required(),
  sellingPrice: Joi.number().min(0).required(),
  currency: Joi.string().valid('INR').default('INR'),
});

export const listingCreateSchema = Joi.object({
  productMasterId: objectId.required(),
  variantId: optionalObjectId,
  price: priceInput,
  stockQty: Joi.number().integer().min(0).default(0),
  status: Joi.string().valid(...Object.values(TENANT_LISTING_STATUS)).default(TENANT_LISTING_STATUS.DRAFT),
  orderLimits: Joi.object({
    minOrderQty: Joi.number().integer().min(1),
    maxOrderQty: Joi.number().integer().min(1),
  }),
});

export const listingUpdatePriceSchema = Joi.object({
  price: priceInput.required(),
  reason: Joi.string().valid('manual', 'promotion', 'bulk', 'admin_override', 'reset').default('manual'),
  expectedVersion: Joi.number().integer().min(1).required(),
});

export const listingUpdateStatusSchema = Joi.object({
  status: Joi.string().valid(...Object.values(TENANT_LISTING_STATUS)).required(),
  expectedVersion: Joi.number().integer().min(1).required(),
});

export const listingQuerySchema = Joi.object({
  status: Joi.string().valid(...Object.values(TENANT_LISTING_STATUS)),
  search: Joi.string().max(120).allow('', null),
  categoryId: optionalObjectId,
  brandId: optionalObjectId,
  minPrice: Joi.number().min(0),
  maxPrice: Joi.number().min(0),
  ...pagination,
});

// ---------------- Change requests ----------------
export const changeRequestCreateSchema = Joi.object({
  type: Joi.string().valid(...Object.values(CHANGE_REQUEST_TYPE)).required(),
  productMasterId: Joi.when('type', {
    is: Joi.valid('create_master'),
    then: Joi.forbidden(),
    otherwise: objectId.required(),
  }),
  payload: Joi.object().allow(null),
  diff: Joi.object({
    before: Joi.object().allow(null),
    after: Joi.object().required(),
  }),
  note: Joi.string().max(500).allow(null, ''),
});

export const changeRequestReviewSchema = Joi.object({
  decision: Joi.string().valid('approve', 'reject', 'needs_changes').required(),
  note: Joi.string().max(800).allow(null, ''),
});

export const changeRequestQuerySchema = Joi.object({
  status: Joi.string().valid(...Object.values(CHANGE_REQUEST_STATUS)),
  type: Joi.string().valid(...Object.values(CHANGE_REQUEST_TYPE)),
  ...pagination,
});

// ---------------- Inventory ----------------
export const inventoryOpSchema = Joi.object({
  listingId: objectId.required(),
  op: Joi.string().valid('set', 'adjust', 'reserve', 'release').required(),
  qty: Joi.number().integer().required(), // for set/adjust signed; reserve/release must be >= 0
  orderRef: Joi.string().max(80).allow(null, ''),
  note: Joi.string().max(300).allow(null, ''),
  expectedVersion: Joi.number().integer().min(1),
});

// ---------------- Customer catalog query ----------------
export const catalogQuerySchema = Joi.object({
  search: Joi.string().max(120).allow('', null),
  categoryId: optionalObjectId,
  brandId: optionalObjectId,
  type: Joi.string().valid(...Object.values(PRODUCT_TYPE)),
  minPrice: Joi.number().min(0),
  maxPrice: Joi.number().min(0),
  inStock: Joi.boolean(),
  sort: Joi.string().valid('relevance', 'price_asc', 'price_desc', 'newest', 'popularity').default('relevance'),
  ...pagination,
});

// ---------------- Audit ----------------
export const auditQuerySchema = Joi.object({
  entityType: Joi.string().max(60),
  entityId: optionalObjectId,
  action: Joi.string().valid(...Object.values(AUDIT_ACTION)),
  actorId: optionalObjectId,
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  ...pagination,
});

// ---------------- Bulk ----------------
export const bulkQuerySchema = Joi.object({
  dryRun: Joi.boolean().default(false),
});

export const idParamSchema = Joi.object({
  id: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
});
