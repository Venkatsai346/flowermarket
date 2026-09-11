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
const heroSlideInput = Joi.object({
  imageUrl: Joi.string().uri({ allowRelative: true }).required(),
  mobileImageUrl: Joi.string().uri({ allowRelative: true }).allow('', null).optional(),
  title: Joi.string().max(80).allow('', null).optional(),
  subtitle: Joi.string().max(160).allow('', null).optional(),
  ctaLabel: Joi.string().max(30).allow('', null).optional(),
  ctaLink: Joi.string().max(300).allow('', null).optional(),
  sortOrder: Joi.number().integer().min(0).max(100).optional(),
  isActive: Joi.boolean().optional(),
});

const highlightInput = Joi.object({
  icon: Joi.string().max(30).allow('', null).optional(),
  title: Joi.string().max(60).required(),
  text: Joi.string().max(200).allow('', null).optional(),
});

const testimonialInput = Joi.object({
  name: Joi.string().max(80).required(),
  text: Joi.string().max(500).required(),
  rating: Joi.number().integer().min(1).max(5).allow(null).optional(),
  avatarUrl: Joi.string().uri({ allowRelative: true }).allow('', null).optional(),
});

export const storeUpdateSchema = Joi.object({
  name: Joi.string().max(120).optional(),
  logoUrl: Joi.string().uri({ allowRelative: true }).allow('', null).optional(),
  theme: Joi.object({
    kit: Joi.string().valid('rose', 'marigold', 'tropical').optional(),
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
    youtube: Joi.string().uri().allow('', null).optional(),
    x: Joi.string().uri().allow('', null).optional(),
    whatsapp: Joi.string().max(30).allow('', null).optional(),
  }).optional(),
  // Rich storefront content (all arrays bounded — they ship in bootstrap).
  heroSlides: Joi.array().items(heroSlideInput).max(8).optional(),
  announcement: Joi.object({
    text: Joi.string().max(120).allow('', null).optional(),
    linkUrl: Joi.string().max(300).allow('', null).optional(),
    isActive: Joi.boolean().optional(),
  }).optional(),
  about: Joi.object({
    title: Joi.string().max(120).allow('', null).optional(),
    content: Joi.string().max(4000).allow('', null).optional(),
    imageUrl: Joi.string().uri({ allowRelative: true }).allow('', null).optional(),
    videoUrl: Joi.string().uri({ allowRelative: true }).allow('', null).optional(),
  }).optional(),
  highlights: Joi.array().items(highlightInput).max(6).optional(),
  testimonials: Joi.array().items(testimonialInput).max(12).optional(),
  contact: Joi.object({
    phone: Joi.string().max(20).allow('', null).optional(),
    email: Joi.string().email().allow('', null).optional(),
    address: Joi.object({
      line1: Joi.string().max(120).allow('', null).optional(),
      line2: Joi.string().max(120).allow('', null).optional(),
      city: Joi.string().max(80).allow('', null).optional(),
      state: Joi.string().max(80).allow('', null).optional(),
      pincode: Joi.string().max(10).allow('', null).optional(),
    }).optional(),
    hours: Joi.string().max(200).allow('', null).optional(),
    whatsapp: Joi.string().max(20).allow('', null).optional(),
    mapUrl: Joi.string().uri().allow('', null).optional(),
  }).optional(),
  seo: Joi.object({
    title: Joi.string().max(70).allow('', null).optional(),
    description: Joi.string().max(170).allow('', null).optional(),
  }).optional(),
  footerText: Joi.string().max(300).allow('', null).optional(),
  featuredCategoryIds: Joi.array().items(objectId).max(12).unique().optional(),
  featuredBrandIds: Joi.array().items(objectId).max(12).unique().optional(),
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

// Owner pay takes no body: the money rail is a server config decision, never a
// client choice (a browser-picked "mock" would mark invoices paid for free).
export const invoicePaySchema = Joi.object({});

export const emailVerifyConfirmSchema = Joi.object({
  code: Joi.string().trim().min(4).max(10).required(),
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

export const tenantIdParamSchema = Joi.object({
  id: objectId.required(),
});

export const tenantStatusSchema = Joi.object({
  status: Joi.string().valid('active', 'suspended', 'inactive', 'blocked').required(),
  reason: Joi.string().max(500).allow('', null).optional(),
});
