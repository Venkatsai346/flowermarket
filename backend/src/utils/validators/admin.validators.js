/**
 * Admin dashboard (Phase 4) request schemas.
 */
import Joi from 'joi';

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message('Invalid id');
const dateStr = Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).message('Use YYYY-MM-DD');
const optionalDate = Joi.date().optional().allow(null);

export const adminDateRangeSchema = Joi.object({
  from: dateStr.required(),
  to: dateStr.required(),
  hubId: objectId.allow('', null).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  page: Joi.number().integer().min(1).optional(),
});

export const adminListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(200).optional(),
  status: Joi.string().allow('').optional(),
  search: Joi.string().allow('', null).optional(),
  categoryId: objectId.allow('', null).optional(),
  health: Joi.string().valid('in_stock', 'low_stock', 'out_of_stock').optional(),
  lowStockThreshold: Joi.number().integer().min(0).optional(),
  role: Joi.string().allow('').optional(),
  from: dateStr.allow('', null).optional(),
  to: dateStr.allow('', null).optional(),
});

export const inventoryAdjustSchema = Joi.object({
  type: Joi.string().valid('restock', 'shrinkage', 'audit_correction', 'return_restock').required(),
  qtyChange: Joi.number().integer().min(-999999).max(999999).required().custom((v) => (v === 0 ? { message: 'qtyChange must be non-zero' } : v)),
  reason: Joi.string().min(3).max(300).required(),
  note: Joi.string().max(500).allow(null, '').optional(),
});

export const hubCreateSchema = Joi.object({
  name: Joi.string().max(120).required(),
  code: Joi.string().max(40).required(),
  address: Joi.object({ line1: Joi.string().max(160).allow('', null), city: Joi.string().max(80).allow('', null), state: Joi.string().max(80).allow('', null), pincode: Joi.string().max(12).allow('', null) }).optional(),
  coordinates: Joi.array().items(Joi.number()).length(2).optional(),
  pincodes: Joi.array().items(Joi.string().regex(/^\d{6}$/)).max(200).optional(),
  defaultSlotCapacity: Joi.number().integer().min(1).max(10000).optional(),
  isActive: Joi.boolean().optional(),
});

export const hubUpdateSchema = Joi.object({
  name: Joi.string().max(120).optional(),
  address: Joi.object({ line1: Joi.string().max(160).allow('', null), city: Joi.string().max(80).allow('', null), state: Joi.string().max(80).allow('', null), pincode: Joi.string().max(12).allow('', null) }).optional(),
  coordinates: Joi.array().items(Joi.number()).length(2).optional(),
  defaultSlotCapacity: Joi.number().integer().min(1).max(10000).optional(),
});

export const hubToggleSchema = Joi.object({ isActive: Joi.boolean().required() });

export const hubPincodesSchema = Joi.object({
  add: Joi.array().items(Joi.string().regex(/^\d{6}$/)).max(200).default([]),
  remove: Joi.array().items(Joi.string().regex(/^\d{6}$/)).max(200).default([]),
});

export const slotListQuerySchema = Joi.object({
  hubId: objectId.allow('', null).optional(),
  from: dateStr.required(),
  to: dateStr.required(),
});

export const slotOverrideSchema = Joi.object({
  manualCapacity: Joi.number().integer().min(1).max(100000).required(),
  reason: Joi.string().min(3).max(300).required(),
});

export const slotStatusSchema = Joi.object({
  status: Joi.string().valid('open', 'closed').required(),
  reason: Joi.string().max(300).allow(null, '').optional(),
});

export const adminOrderListSchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(200).optional(),
  status: Joi.string().allow('').optional(),
  search: Joi.string().allow('', null).optional(),
  paymentMethod: Joi.string().allow('').optional(),
  hubId: objectId.allow('', null).optional(),
  minTotal: Joi.number().min(0).optional(),
  maxTotal: Joi.number().min(0).optional(),
  from: dateStr.allow('', null).optional(),
  to: dateStr.allow('', null).optional(),
});

export const staffCreateSchema = Joi.object({
  role: Joi.string().valid('admin', 'picker', 'rider').required(),
  firstName: Joi.string().max(80).allow('', null).optional(),
  lastName: Joi.string().max(80).allow('', null).optional(),
  phone: Joi.object({ countryCode: Joi.string().default('+91'), number: Joi.string().regex(/^\d{10}$/).message('10-digit number') }).optional(),
  email: Joi.string().email().allow('', null).optional(),
  password: Joi.string().min(8).max(72).allow(null, '').optional(),
  hubId: objectId.allow(null).optional(),
}).custom((v) => {
  if (!v.phone && !v.email) return { message: 'phone or email is required' };
  return v;
});

export const userStatusSchema = Joi.object({ status: Joi.string().valid('active', 'blocked', 'inactive', 'verification_pending').required() });

export const userRoleSchema = Joi.object({
  role: Joi.string().valid('customer', 'vendor', 'admin', 'picker', 'rider').required(),
});

export const adminAnalyticsQuerySchema = Joi.object({
  from: dateStr.required(),
  to: dateStr.required(),
  hubId: objectId.allow('', null).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

export const rebuildSchema = Joi.object({ from: dateStr.required(), to: dateStr.required() });

export const riderStatsQuerySchema = Joi.object({
  from: dateStr.allow('', null).optional(),
  to: dateStr.allow('', null).optional(),
  riderId: objectId.allow('', null).optional(),
});

// ---------------- Phase 4b: notifications / exports / maintenance ----------------

export const templateCreateSchema = Joi.object({
  code: Joi.string().max(64).required(),
  eventType: Joi.string().max(64).allow('', null).optional(),
  channels: Joi.array().items(Joi.string().valid('push', 'email', 'sms')).min(1).optional(),
  content: Joi.object({
    push: Joi.object({ subject: Joi.string().max(200).allow('', null).optional(), body: Joi.string().max(1000).allow('', null).optional() }).optional(),
    email: Joi.object({ subject: Joi.string().max(200).allow('', null).optional(), body: Joi.string().max(10000).allow('', null).optional() }).optional(),
    sms: Joi.object({ body: Joi.string().max(1600).allow('', null).optional() }).optional(),
  }).optional(),
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').optional(),
  isActive: Joi.boolean().optional(),
  effectiveFrom: Joi.date().allow(null).optional(),
  effectiveTo: Joi.date().allow(null).optional(),
});

export const templateUpdateSchema = Joi.object({
  eventType: Joi.string().max(64).allow('', null).optional(),
  channels: Joi.array().items(Joi.string().valid('push', 'email', 'sms')).min(1).optional(),
  content: Joi.object({
    push: Joi.object({ subject: Joi.string().max(200).allow('', null).optional(), body: Joi.string().max(1000).allow('', null).optional() }).optional(),
    email: Joi.object({ subject: Joi.string().max(200).allow('', null).optional(), body: Joi.string().max(10000).allow('', null).optional() }).optional(),
    sms: Joi.object({ body: Joi.string().max(1600).allow('', null).optional() }).optional(),
  }).optional(),
  priority: Joi.string().valid('low', 'normal', 'high', 'urgent').optional(),
  isActive: Joi.boolean().optional(),
  effectiveFrom: Joi.date().allow(null).optional(),
  effectiveTo: Joi.date().allow(null).optional(),
});

export const adminNotificationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(200).optional(),
  status: Joi.string().allow('').optional(),
  userId: objectId.allow('', null).optional(),
  from: dateStr.allow('', null).optional(),
  to: dateStr.allow('', null).optional(),
});

export const adminSendNotificationSchema = Joi.object({
  templateCode: Joi.string().max(64).required(),
  userId: objectId.required(),
  orderId: objectId.allow(null).optional(),
  data: Joi.object().optional(),
  channels: Joi.array().items(Joi.string().valid('push', 'email', 'sms')).min(1).optional(),
  dedupeKey: Joi.string().max(120).allow(null, '').optional(),
});

export const processNotificationsSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(500).optional(),
});

export const exportCreateSchema = Joi.object({
  type: Joi.string().valid('analytics_daily', 'orders', 'inventory', 'products', 'users').required(),
  params: Joi.object({
    from: dateStr.allow('', null).optional(),
    to: dateStr.allow('', null).optional(),
    hubId: objectId.allow('', null).optional(),
    query: Joi.object().optional(),
  }).optional(),
  scheduledFor: Joi.date().allow(null).optional(),
});

export const exportListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  status: Joi.string().valid('pending', 'running', 'done', 'failed').allow('').optional(),
  type: Joi.string().valid('analytics_daily', 'orders', 'inventory', 'products', 'users').allow('').optional(),
});

export const runDueExportsSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(50).optional(),
});

export const nightlySchema = Joi.object({
  forecastDays: Joi.number().integer().min(1).max(14).optional(),
  analyticsDays: Joi.number().integer().min(1).max(90).optional(),
  exportLimit: Joi.number().integer().min(1).max(50).optional(),
  eventLimit: Joi.number().integer().min(1).max(200).optional(),
  notificationLimit: Joi.number().integer().min(1).max(500).optional(),
});
