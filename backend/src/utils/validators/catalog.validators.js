import Joi from 'joi';
import {
  PRODUCT_MASTER_STATUS,
  TENANT_LISTING_STATUS,
  CHANGE_REQUEST_TYPE,
  CHANGE_REQUEST_STATUS,
  AUDIT_ACTION,
  SELLING_UNIT,
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
  appliesTo: Joi.string().valid('master', 'variant', 'both').default('master'),
  options: Joi.array().items(Joi.string().max(100)).max(100),
  unit: Joi.string().max(20),
  min: Joi.number(),
  max: Joi.number(),
  regex: Joi.string().max(500),
  multiple: Joi.boolean().default(false),
  filterable: Joi.boolean().default(false),
  facetable: Joi.boolean().default(false),
  searchable: Joi.boolean().default(false),
  group: Joi.string().max(80).allow(null, ''),
  sortOrder: Joi.number().integer().min(0),
});

export const categoryCreateSchema = Joi.object({
  name: Joi.string().max(120).required(),
  slug: Joi.string().max(140).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  parentId: optionalObjectId,
  description: Joi.string().max(500).allow(null, ''),
  imageUrl: Joi.string().uri({ allowRelative: true }).allow(null, ''),
  iconUrl: Joi.string().uri({ allowRelative: true }).allow(null, ''),
  bannerUrl: Joi.string().uri({ allowRelative: true }).allow(null, ''),
  attributeSchema: Joi.array().items(attributeSchemaField).max(100),
  complianceRequirements: Joi.array().items(Joi.object({
    code: Joi.string().max(100).required(),
    type: Joi.string().valid('certificate', 'license', 'regulatory_id', 'standard', 'restriction', 'safety', 'environmental').required(),
    label: Joi.string().max(160).required(), required: Joi.boolean().default(true), requiresExpiry: Joi.boolean().default(false),
    jurisdictions: Joi.array().items(Joi.string().max(80)).max(100),
  })).max(100),
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
  bannerUrl: Joi.string().uri({ allowRelative: true }).allow(null, ''),
  tagline: Joi.string().max(160).allow(null, ''),
  description: Joi.string().max(500).allow(null, ''),
  story: Joi.string().max(3000).allow(null, ''),
  countryOfOrigin: Joi.string().max(60).allow(null, ''),
  website: Joi.string().uri().allow(null, ''),
  foundedYear: Joi.number().integer().min(1800).max(2100).allow(null),
  headquarters: Joi.string().max(120).allow(null, ''),
  socialLinks: Joi.object({
    instagram: Joi.string().uri().allow(null, ''),
    facebook: Joi.string().uri().allow(null, ''),
    youtube: Joi.string().uri().allow(null, ''),
    x: Joi.string().uri().allow(null, ''),
  }),
  isFeatured: Joi.boolean().default(false),
  sortOrder: Joi.number().integer().min(0).default(0),
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
  featured: Joi.boolean(),
  search: Joi.string().max(120).allow('', null),
  ...pagination,
});

// ---------------- ProductMaster ----------------
const attributeValue = Joi.alternatives().try(
  Joi.string().max(4000),
  Joi.number(),
  Joi.boolean(),
  Joi.date().iso(),
  Joi.array().items(Joi.alternatives().try(Joi.string().max(500), Joi.number(), Joi.boolean())).max(100),
  Joi.object().unknown(true),
);
const masterAttributesInput = Joi.array().items(
  Joi.object({
    key: Joi.string().pattern(/^[a-z0-9_]+$/).required(),
    value: attributeValue.required(),
    unit: Joi.string().max(20).allow(null, ''),
  })
).max(100);

const mediaFields = {
  url: Joi.string().uri({ allowRelative: true }).required(),
  altText: Joi.string().max(300),
  mediaType: Joi.string().valid('image', 'video', 'model_3d', 'document').default('image'),
  role: Joi.string().valid('gallery', 'thumbnail', 'swatch', 'lifestyle', 'size_chart', 'manual').default('gallery'),
  mimeType: Joi.string().max(100).allow(null, ''),
  width: Joi.number().integer().min(1).allow(null),
  height: Joi.number().integer().min(1).allow(null),
  fileSize: Joi.number().integer().min(0).allow(null),
  focalPoint: Joi.object({ x: Joi.number().min(0).max(1), y: Joi.number().min(0).max(1) }),
  isPrimary: Joi.boolean(),
  sortOrder: Joi.number().integer().min(0),
};

const variantImagesInput = Joi.array().items(Joi.object(mediaFields)).max(50);

const optionValueInput = Joi.object({
  code: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).required(),
  name: Joi.string().max(80),
  value: Joi.string().trim().max(100).required(),
});

const productOptionInput = Joi.object({
  code: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).required(),
  name: Joi.string().trim().max(80).required(),
  values: Joi.array().items(Joi.string().trim().max(100)).min(1).max(100).required(),
  displayType: Joi.string().valid('text', 'swatch', 'image').default('text'),
  sortOrder: Joi.number().integer().min(0).default(0),
});

const measurementsInput = {
  weight: Joi.object({
    value: Joi.number().min(0).allow(null),
    unit: Joi.string().valid('mg', 'g', 'kg', 'oz', 'lb').default('g'),
  }),
  dimensions: Joi.object({
    length: Joi.number().min(0).allow(null),
    width: Joi.number().min(0).allow(null),
    height: Joi.number().min(0).allow(null),
    unit: Joi.string().valid('mm', 'cm', 'm', 'in', 'ft').default('cm'),
  }),
};

const masterVariantsInput = Joi.array().items(
  Joi.object({
    variantType: Joi.string().valid(...Object.values(VARIANT_TYPE)).default(VARIANT_TYPE.OTHER),
    value: Joi.string().trim().max(100),
    optionValues: Joi.array().items(optionValueInput).min(1).max(6),
    displayLabel: Joi.string().max(240),
    sku: Joi.string().max(80),
    barcode: Joi.string().max(60).allow(null, ''),
    identifiers: Joi.object({
      gtin: Joi.string().max(32).allow(null, ''),
      mpn: Joi.string().max(100).allow(null, ''),
    }),
    ...measurementsInput,
    sellQuantity: Joi.object({ value: Joi.number().positive().required(), unitCode: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).required() }),
    sortOrder: Joi.number().integer().min(0),
    isDefault: Joi.boolean(),
    images: variantImagesInput,
  }).or('value', 'optionValues')
).max(100);

const masterImagesInput = Joi.array().items(Joi.object(mediaFields)).max(100);

const unitPolicyInput = Joi.object({
  dimension: Joi.string().valid('count', 'mass', 'volume', 'length', 'area', 'time', 'digital', 'custom').required(),
  baseUnit: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).required(),
  allowFractional: Joi.boolean().default(false),
  precision: Joi.number().integer().min(0).max(6).default(3),
  units: Joi.array().items(Joi.object({
    code: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).required(),
    label: Joi.string().max(60).required(),
    toBaseFactor: Joi.number().positive().required(),
    precision: Joi.number().integer().min(0).max(6),
  })).min(1).max(50).required(),
});

const optionRuleInput = Joi.object({
  code: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/),
  when: Joi.object({ code: Joi.string().required(), values: Joi.array().items(Joi.string().max(100)).min(1).max(100).required() }).required(),
  then: Joi.object({
    code: Joi.string().required(),
    allowedValues: Joi.array().items(Joi.string().max(100)).max(100),
    excludedValues: Joi.array().items(Joi.string().max(100)).max(100),
    required: Joi.boolean(),
  }).required(),
  priority: Joi.number().integer(),
});

const universalMasterFields = {
  kind: Joi.string().valid('physical', 'digital', 'service', 'bundle'),
  manufacturer: Joi.string().max(160).allow(null, ''),
  modelNumber: Joi.string().max(100).allow(null, ''),
  countryOfOrigin: Joi.string().max(80).allow(null, ''),
  condition: Joi.string().valid('new', 'refurbished', 'used'),
  identifiers: Joi.object({
    gtin: Joi.string().max(32).allow(null, ''),
    mpn: Joi.string().max(100).allow(null, ''),
    isbn: Joi.string().max(20).allow(null, ''),
    hsn: Joi.string().max(16).allow(null, ''),
  }),
  warranty: Joi.object({
    duration: Joi.number().min(0).allow(null),
    unit: Joi.string().valid('day', 'month', 'year').default('month'),
    description: Joi.string().max(500).allow(null, ''),
  }),
  seo: Joi.object({
    title: Joi.string().max(70).allow(null, ''),
    description: Joi.string().max(180).allow(null, ''),
    keywords: Joi.array().items(Joi.string().max(60)).max(20),
  }),
  options: Joi.array().items(productOptionInput).max(6),
  optionRules: Joi.array().items(optionRuleInput).max(100),
  unitPolicy: unitPolicyInput.allow(null),
  fulfillmentProfile: Joi.object({
    requiresShipping: Joi.boolean(),
    shippingClass: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/),
    ...measurementsInput,
    fragile: Joi.boolean(),
    hazardous: Joi.boolean(),
    ageRestricted: Joi.boolean(),
    requiresSerialTracking: Joi.boolean(),
  }),
};

export const masterCreateSchema = Joi.object({
  skuGlobal: Joi.string().max(80).required(),
  type: Joi.string().pattern(/^[a-z][a-z0-9_]{0,59}$/).required(),
  ...universalMasterFields,
  title: Joi.string().max(160).required(),
  slug: Joi.string().max(200).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  shortDescription: Joi.string().max(300).allow(null, ''),
  description: Joi.string().max(4000).allow(null, ''),
  categoryId: objectId.required(),
  brandId: optionalObjectId,
  barcode: Joi.string().max(60).allow(null, ''),
  tags: Joi.array().items(Joi.string().max(60)).max(50),
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
  type: Joi.string().pattern(/^[a-z][a-z0-9_]{0,59}$/),
  ...universalMasterFields,
  title: Joi.string().max(160),
  slug: Joi.string().max(200).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  shortDescription: Joi.string().max(300).allow(null, ''),
  description: Joi.string().max(4000).allow(null, ''),
  categoryId: objectId,
  brandId: optionalObjectId,
  barcode: Joi.string().max(60).allow(null, ''),
  tags: Joi.array().items(Joi.string().max(60)).max(50),
  isPerishable: Joi.boolean(),
  requiresColdChain: Joi.boolean(),
  defaultSellingUnit: Joi.string().valid(...Object.values(SELLING_UNIT)),
  minOrderQty: Joi.number().integer().min(1),
  maxOrderQty: Joi.number().integer().min(1),
  expectedVersion: Joi.number().integer().min(1).required(),
}).min(1);

export const masterProposeSchema = Joi.object({
  skuGlobal: Joi.string().max(80).required(),
  type: Joi.string().pattern(/^[a-z][a-z0-9_]{0,59}$/).required(),
  ...universalMasterFields,
  title: Joi.string().max(160).required(),
  slug: Joi.string().max(200).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  shortDescription: Joi.string().max(300).allow(null, ''),
  description: Joi.string().max(4000).allow(null, ''),
  categoryId: objectId.required(),
  brandId: optionalObjectId,
  barcode: Joi.string().max(60).allow(null, ''),
  tags: Joi.array().items(Joi.string().max(60)).max(50),
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
  type: Joi.string().pattern(/^[a-z][a-z0-9_]{0,59}$/),
  search: Joi.string().max(120).allow('', null),
  ...pagination,
});

export const variantCreateSchema = Joi.object({
  variantType: Joi.string().valid(...Object.values(VARIANT_TYPE)).default(VARIANT_TYPE.OTHER),
  value: Joi.string().max(100),
  optionValues: Joi.array().items(optionValueInput).min(1).max(6),
  displayLabel: Joi.string().max(240).allow(null, ''),
  sku: Joi.string().max(80).allow(null, ''),
  barcode: Joi.string().max(60).allow(null, ''),
  identifiers: Joi.object({ gtin: Joi.string().max(32).allow(null, ''), mpn: Joi.string().max(100).allow(null, '') }),
  ...measurementsInput,
  sellQuantity: Joi.object({ value: Joi.number().positive().required(), unitCode: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).required() }),
  sortOrder: Joi.number().integer().min(0),
  isDefault: Joi.boolean(),
  images: variantImagesInput,
  expectedVersion: Joi.number().integer().min(1).required(),
}).or('value', 'optionValues');

export const variantUpdateSchema = Joi.object({
  variantType: Joi.string().valid(...Object.values(VARIANT_TYPE)),
  value: Joi.string().max(100),
  optionValues: Joi.array().items(optionValueInput).min(1).max(6),
  displayLabel: Joi.string().max(240).allow(null, ''),
  sku: Joi.string().max(80).allow(null, ''),
  barcode: Joi.string().max(60).allow(null, ''),
  identifiers: Joi.object({ gtin: Joi.string().max(32).allow(null, ''), mpn: Joi.string().max(100).allow(null, '') }),
  ...measurementsInput,
  sellQuantity: Joi.object({ value: Joi.number().positive().required(), unitCode: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).required() }),
  sortOrder: Joi.number().integer().min(0),
  isDefault: Joi.boolean(),
  status: Joi.string().valid('active', 'inactive', 'archived'),
  expectedVersion: Joi.number().integer().min(1).required(),
}).min(1);

export const imageCreateSchema = Joi.object({
  ...mediaFields,
  variantId: optionalObjectId,
  expectedVersion: Joi.number().integer().min(1).required(),
});

/** POST /masters/:id/variants/:variantId/images — scope comes from the path. */
export const variantImageCreateSchema = Joi.object({
  ...mediaFields,
  expectedVersion: Joi.number().integer().min(1).required(),
});

export const versionOnlySchema = Joi.object({
  expectedVersion: Joi.number().integer().min(1).required(),
});

export const imagePrimarySchema = versionOnlySchema;

export const masterReviewSchema = Joi.object({
  decision: Joi.string().valid('approve', 'reject').required(),
  note: Joi.string().max(500).allow(null, ''),
});

export const masterDeprecateSchema = Joi.object({
  note: Joi.string().max(500).allow(null, ''),
});

export const attributeSetSchema = Joi.object({
  attributes: masterAttributesInput.required(),
  expectedVersion: Joi.number().integer().min(1).required(),
});

// ---------------- Advanced universal structures ----------------
const structureAttribute = Joi.object({
  key: Joi.string().pattern(/^[a-z0-9_]+$/).required(), value: attributeValue.required(),
  unit: Joi.string().max(20).allow(null, ''),
});
export const variantAttributeSetSchema = Joi.object({
  attributes: Joi.array().items(structureAttribute).max(100).required(),
  expectedVersion: Joi.number().integer().min(1).required(),
});

const packageInput = Joi.object({
  variantId: optionalObjectId,
  code: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).required(),
  label: Joi.string().max(100).required(),
  level: Joi.string().valid('each', 'inner', 'case', 'pallet', 'custom').default('each'),
  containedPackageCode: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).allow(null, ''),
  quantity: Joi.number().positive().required(),
  unitCode: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).required(),
  identifiers: Joi.object({
    sku: Joi.string().max(80).allow(null, ''), barcode: Joi.string().max(60).allow(null, ''), gtin: Joi.string().max(32).allow(null, ''),
  }),
  ...measurementsInput,
  status: Joi.string().valid('active', 'inactive', 'archived'),
  sortOrder: Joi.number().integer().min(0),
});
export const packageSetSchema = Joi.object({
  packages: Joi.array().items(packageInput).max(100).required(),
  expectedVersion: Joi.number().integer().min(1).required(),
});

const bundleComponentInput = Joi.object({
  componentMasterId: objectId.required(), componentVariantId: optionalObjectId,
  quantity: Joi.number().positive().required(), unitCode: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).required(),
  selectionGroup: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).default('included'),
  required: Joi.boolean().default(true), defaultSelected: Joi.boolean().default(true),
  minSelections: Joi.number().integer().min(0).default(1), maxSelections: Joi.number().integer().min(1).default(1),
  priceAdjustment: Joi.number().default(0), sortOrder: Joi.number().integer().min(0),
  status: Joi.string().valid('active', 'inactive', 'archived'),
});
export const bundleComponentSetSchema = Joi.object({
  components: Joi.array().items(bundleComponentInput).max(200).required(),
  expectedVersion: Joi.number().integer().min(1).required(),
});

const complianceInput = Joi.object({
  variantId: optionalObjectId,
  type: Joi.string().valid('certificate', 'license', 'regulatory_id', 'standard', 'restriction', 'safety', 'environmental').required(),
  code: Joi.string().max(100).required(), title: Joi.string().max(200).required(),
  authority: Joi.string().max(160).allow(null, ''),
  jurisdiction: Joi.object({
    country: Joi.string().length(2).uppercase().default('IN'), state: Joi.string().max(80).allow(null, ''),
    regions: Joi.array().items(Joi.string().max(80)).max(100),
  }),
  status: Joi.string().valid('draft', 'pending', 'verified', 'expired', 'rejected').default('draft'),
  validFrom: Joi.date().iso().allow(null), validUntil: Joi.date().iso().allow(null),
  issuerReference: Joi.string().max(200).allow(null, ''),
  documents: Joi.array().items(Joi.object({
    name: Joi.string().max(160).required(), url: Joi.string().uri({ allowRelative: true }).required(),
    mimeType: Joi.string().max(100).allow(null, ''), checksum: Joi.string().max(128).allow(null, ''),
  })).max(20),
  restrictions: Joi.array().items(Joi.string().max(200)).max(50),
  metadata: Joi.object().unknown(true),
});
export const complianceSetSchema = Joi.object({
  records: Joi.array().items(complianceInput).max(200).required(),
  expectedVersion: Joi.number().integer().min(1).required(),
});

// ---------------- TenantProduct (listing) ----------------
const priceInput = Joi.object({
  mrp: Joi.number().min(0).allow(null),
  sellingPrice: Joi.number().min(0).required(),
  costPrice: Joi.number().min(0).allow(null),
  saleStartsAt: Joi.date().iso().allow(null),
  saleEndsAt: Joi.date().iso().min(Joi.ref('saleStartsAt')).allow(null),
  taxInclusive: Joi.boolean().default(true),
  currency: Joi.string().valid('INR').default('INR'),
});

const listingUniversalFields = {
  sellerSku: Joi.string().max(100).allow(null, ''),
  priceBasis: Joi.object({
    quantity: Joi.number().positive().required(), unitCode: Joi.string().pattern(/^[a-z][a-z0-9_]{0,39}$/).required(),
  }),
  sellingPolicy: Joi.object({
    allowBackorder: Joi.boolean(),
    preorder: Joi.boolean(),
    availableFrom: Joi.date().iso().allow(null),
    availableUntil: Joi.date().iso().allow(null),
    leadTimeDays: Joi.number().integer().min(0).max(365),
  }),
  merchandising: Joi.object({
    titleOverride: Joi.string().max(160).allow(null, ''),
    descriptionOverride: Joi.string().max(1000).allow(null, ''),
    badges: Joi.array().items(Joi.string().max(40)).max(10),
    featured: Joi.boolean(),
    searchBoost: Joi.number().min(-100).max(100),
  }),
  channels: Joi.object({
    storefront: Joi.boolean(), marketplace: Joi.boolean(), pos: Joi.boolean(), wholesale: Joi.boolean(),
  }),
};

export const listingCreateSchema = Joi.object({
  productMasterId: objectId.required(),
  variantId: optionalObjectId,
  ...listingUniversalFields,
  price: priceInput,
  stockQty: Joi.number().integer().min(0).default(0),
  status: Joi.string().valid(...Object.values(TENANT_LISTING_STATUS)).default(TENANT_LISTING_STATUS.DRAFT),
  orderLimits: Joi.object({
    minOrderQty: Joi.number().integer().min(1),
    maxOrderQty: Joi.number().integer().min(1),
  }),
});

export const listingUpdateOfferSchema = Joi.object({
  sellerSku: listingUniversalFields.sellerSku,
  priceBasis: listingUniversalFields.priceBasis,
  sellingPolicy: listingUniversalFields.sellingPolicy,
  merchandising: listingUniversalFields.merchandising,
  channels: listingUniversalFields.channels,
  orderLimits: Joi.object({ minOrderQty: Joi.number().integer().min(1).allow(null), maxOrderQty: Joi.number().integer().min(1).allow(null) }),
  expectedVersion: Joi.number().integer().min(1).required(),
}).min(2);

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
  productMasterId: optionalObjectId,
  minPrice: Joi.number().min(0),
  maxPrice: Joi.number().min(0),
  ...pagination,
});

/**
 * POST /catalog/tenant/listings/bulk — list many variants of ONE master at
 * once, each with its own price/stock/status (the case-1/2/3 wizard payload).
 * Either `selections` (explicit per-variant rows) or `selectAll` (every active
 * variant with shared `defaults`) is required.
 */
const bulkSelectionRow = Joi.object({
  variantId: optionalObjectId,
  ...listingUniversalFields,
  price: priceInput,
  stockQty: Joi.number().integer().min(0).default(0),
  status: Joi.string().valid(...Object.values(TENANT_LISTING_STATUS)).default(TENANT_LISTING_STATUS.DRAFT),
  orderLimits: Joi.object({
    minOrderQty: Joi.number().integer().min(1),
    maxOrderQty: Joi.number().integer().min(1),
  }),
});

export const listingBulkSchema = Joi.object({
  productMasterId: objectId.required(),
  selections: Joi.array().items(bulkSelectionRow).max(100),
  selectAll: Joi.boolean().default(false),
  defaults: Joi.object({
    ...listingUniversalFields,
    price: priceInput,
    stockQty: Joi.number().integer().min(0).default(0),
    status: Joi.string().valid(...Object.values(TENANT_LISTING_STATUS)).default(TENANT_LISTING_STATUS.DRAFT),
  }),
  onConflict: Joi.string().valid('skip', 'error').default('skip'),
}).custom((v, helpers) => {
  if (!v.selectAll && !(v.selections?.length)) {
    return helpers.error('any.custom', { message: 'selections or selectAll is required' });
  }
  return v;
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

// ---------------- Inventory (tenant stock ops) ----------------
// These schemas are the edge contract for PUT/PATCH /listings/:id/stock.
// The listing id comes from the path; the body carries only the quantity.
export const stockSetSchema = Joi.object({
  qty: Joi.number().integer().min(0).max(1_000_000).required(),
});

export const stockAdjustSchema = Joi.object({
  delta: Joi.number().integer().min(-1_000_000).max(1_000_000).invalid(0).required(),
});

// ---------------- Customer catalog query ----------------
export const catalogQuerySchema = Joi.object({
  search: Joi.string().max(120).allow('', null),
  q: Joi.string().max(120).allow('', null),
  categoryId: optionalObjectId,
  brandId: optionalObjectId,
  type: Joi.string().pattern(/^[a-z][a-z0-9_]{0,59}$/),
  minPrice: Joi.number().min(0),
  maxPrice: Joi.number().min(0),
  inStock: Joi.boolean(),
  sort: Joi.string().valid('relevance', 'price_asc', 'price_desc', 'newest', 'popularity').default('relevance'),
  // groupBy=master -> one card per master with the full variant family.
  groupBy: Joi.string().valid('master'),
  ...pagination,
});

/** PDP / stock-check variant selection (?variantId=). */
export const productDetailQuerySchema = Joi.object({
  variantId: optionalObjectId,
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

/** Nested master sub-resources: /masters/:id/variants/:variantId etc. */
export const masterVariantParamSchema = Joi.object({
  id: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
  variantId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
});

export const masterImageParamSchema = Joi.object({
  id: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
  imageId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
});

export const slugParamSchema = Joi.object({
  slug: Joi.string().max(200).pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).required(),
});
