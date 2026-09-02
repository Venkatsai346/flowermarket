/**
 * Marketplace (Phase 5) request schemas.
 */
import Joi from 'joi';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message('Invalid id');
const dateStr = Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).message('Use YYYY-MM-DD');
const slug = Joi.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).message('Lowercase letters, numbers, hyphens');

// ---------------- public ----------------
export const storeRegisterSchema = Joi.object({
  name: Joi.string().max(120).required(),
  slug: slug.required(),
  plan: Joi.string().max(40).default('free'),
  contactEmail: Joi.string().email().allow('', null).optional(),
  owner: Joi.object({
    firstName: Joi.string().max(80).allow('', null).optional(),
    lastName: Joi.string().max(80).allow('', null).optional(),
    email: Joi.string().email().required(),
    phone: Joi.string().regex(/^\d{10}$/).allow('', null).optional(),
    password: Joi.string().min(8).max(72).required(),
  }).required(),
});

export const storeListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(50).optional(),
  search: Joi.string().max(100).allow('', null).optional(),
});

export const dateRangeQuerySchema = Joi.object({
  from: dateStr.required(),
  to: dateStr.required(),
  limit: Joi.number().integer().min(1).max(25).optional(),
});

// ---------------- vendor ----------------
export const vendorApplySchema = Joi.object({
  businessName: Joi.string().max(120).required(),
  slug: slug.allow('', null).optional(),
  contactPhone: Joi.string().max(20).allow('', null).optional(),
  gstin: Joi.string().max(20).allow('', null).optional(),
  categories: Joi.array().items(Joi.string().max(80)).max(20).optional(),
  city: Joi.string().max(80).allow('', null).optional(),
});

export const vendorProfileUpdateSchema = Joi.object({
  businessName: Joi.string().max(120).optional(),
  city: Joi.string().max(80).allow('', null).optional(),
  categories: Joi.array().items(Joi.string().max(80)).max(20).optional(),
  gstin: Joi.string().max(20).allow('', null).optional(),
  payout: Joi.object({
    method: Joi.string().valid('bank', 'upi').optional(),
    name: Joi.string().max(120).allow('', null).optional(),
    maskedAccount: Joi.string().max(40).allow('', null).optional(),
  }).optional(),
});

export const vendorProductCreateSchema = Joi.object({
  title: Joi.string().max(160).required(),
  type: Joi.string().required(),
  categoryId: objectId.required(),
  brandId: objectId.allow(null).optional(),
  skuGlobal: Joi.string().max(80).required(),
  shortDescription: Joi.string().max(300).allow('', null).optional(),
  description: Joi.string().max(4000).allow('', null).optional(),
  tags: Joi.array().items(Joi.string().max(40)).max(10).optional(),
  isPerishable: Joi.boolean().optional(),
  minOrderQty: Joi.number().integer().min(1).optional(),
  maxOrderQty: Joi.number().integer().min(1).optional(),
});

export const vendorProductUpdateSchema = Joi.object({
  title: Joi.string().max(160).optional(),
  shortDescription: Joi.string().max(300).allow('', null).optional(),
  description: Joi.string().max(4000).allow('', null).optional(),
  tags: Joi.array().items(Joi.string().max(40)).max(10).optional(),
  brandId: objectId.allow(null).optional(),
  isPerishable: Joi.boolean().optional(),
  minOrderQty: Joi.number().integer().min(1).optional(),
  maxOrderQty: Joi.number().integer().min(1).optional(),
});

export const vendorStatusQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  status: Joi.string().allow('').optional(),
  search: Joi.string().max(100).allow('', null).optional(),
});

// ---------------- store owner ----------------
export const storeUpdateSchema = Joi.object({
  name: Joi.string().max(120).optional(),
  logoUrl: Joi.string().uri({ allowRelative: true }).allow('', null).optional(),
  theme: Joi.object({
    primaryColor: Joi.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    accentColor: Joi.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }).optional(),
  tagline: Joi.string().max(160).allow('', null).optional(),
  description: Joi.string().max(2000).allow('', null).optional(),
  bannerUrl: Joi.string().uri({ allowRelative: true }).allow('', null).optional(),
  socialLinks: Joi.object({
    instagram: Joi.string().uri().allow('', null).optional(),
    facebook: Joi.string().uri().allow('', null).optional(),
    website: Joi.string().uri().allow('', null).optional(),
  }).optional(),
  isPublished: Joi.boolean().optional(),
});

export const planChangeSchema = Joi.object({
  planCode: Joi.string().max(40).required(),
});

export const invoiceListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  status: Joi.string().valid('draft', 'open', 'paid', 'overdue', 'void').allow('').optional(),
});

// ---------------- platform admin ----------------
export const applicationReviewSchema = Joi.object({
  decision: Joi.string().valid('approve', 'reject').required(),
  note: Joi.string().max(500).allow('', null).optional(),
});

export const vendorAdminUpdateSchema = Joi.object({
  commissionRateBps: Joi.number().integer().min(0).max(10000).optional(),
  status: Joi.string().valid('active', 'suspended').optional(),
});

export const planCreateSchema = Joi.object({
  code: Joi.string().max(40).required(),
  name: Joi.string().max(80).required(),
  description: Joi.string().max(400).allow('', null).optional(),
  priceMonthly: Joi.number().min(0).required(),
  commissionRateBps: Joi.number().integer().min(0).max(10000).optional(),
  features: Joi.object({
    maxHubs: Joi.number().integer().min(0).optional(),
    maxProducts: Joi.number().integer().min(0).optional(),
    maxStaff: Joi.number().integer().min(0).optional(),
    marketplaceEnabled: Joi.boolean().optional(),
  }).optional(),
  trialDays: Joi.number().integer().min(0).optional(),
  isActive: Joi.boolean().optional(),
  sortOrder: Joi.number().integer().optional(),
});

export const planUpdateSchema = Joi.object({
  name: Joi.string().max(80).optional(),
  description: Joi.string().max(400).allow('', null).optional(),
  priceMonthly: Joi.number().min(0).optional(),
  commissionRateBps: Joi.number().integer().min(0).max(10000).optional(),
  features: Joi.object({
    maxHubs: Joi.number().integer().min(0).optional(),
    maxProducts: Joi.number().integer().min(0).optional(),
    maxStaff: Joi.number().integer().min(0).optional(),
    marketplaceEnabled: Joi.boolean().optional(),
  }).optional(),
  trialDays: Joi.number().integer().min(0).optional(),
  isActive: Joi.boolean().optional(),
  sortOrder: Joi.number().integer().optional(),
});

export const billingCycleSchema = Joi.object({
  tenantId: objectId.allow(null, '').optional(),
  period: dateStr.allow(null, '').optional(),
});

export const rebuildPlatformSchema = Joi.object({
  from: dateStr.required(),
  to: dateStr.required(),
});

export const nightlyMarketplaceSchema = Joi.object({
  days: Joi.number().integer().min(1).max(90).optional(),
});
