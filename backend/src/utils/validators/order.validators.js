import Joi from 'joi';

export const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message('Invalid id');

export const addCartItemSchema = Joi.object({
  tenantProductId: objectId.required(),
  qty: Joi.number().integer().min(1).max(99).required(),
});

export const updateCartItemSchema = Joi.object({
  qty: Joi.number().integer().min(1).max(99).required(),
});

export const checkoutQuoteSchema = Joi.object({
  slotReservationId: objectId.required(),
  addressId: objectId.required(),
  confirmPriceChanges: Joi.boolean().default(false),
});

export const checkoutSchema = Joi.object({
  slotReservationId: objectId.required(),
  addressId: objectId.required(),
  paymentMethod: Joi.string().valid('upi', 'card', 'netbanking', 'cod', 'wallet').default('upi'),
  idempotencyKey: Joi.string().max(80).allow(null).optional(),
  confirmPriceChanges: Joi.boolean().default(false),
  source: Joi.string().valid('app', 'web', 'admin').default('app'),
});

export const cancelOrderSchema = Joi.object({
  reason: Joi.string().valid(
    'customer_requested', 'changed_mind', 'duplicate_order',
    'payment_failed', 'stock_unavailable', 'delivery_failed_max_retries',
    'admin_force', 'other'
  ).default('customer_requested'),
  reasonText: Joi.string().max(500).allow(null, '').optional(),
});

export const orderListQuerySchema = Joi.object({
  status: Joi.string().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().allow('', null).optional(),
});

export const deliverSchema = Joi.object({
  podType: Joi.string().valid('otp', 'photo', 'signature').required(),
  podValue: Joi.string().max(512).allow(null, '').optional(),
});

export const podVerifySchema = Joi.object({
  otp: Joi.string().regex(/^\d{4}$/).message('OTP must be 4 digits').required(),
});

export const createReturnSchema = Joi.object({
  orderId: objectId.required(),
  items: Joi.array()
    .min(1)
    .max(50)
    .items(Joi.object({
      orderItemId: objectId.required(),
      qty: Joi.number().integer().min(1).required(),
    }))
    .required(),
  reason: Joi.string().max(500).required(),
  reasonCode: Joi.string().max(64).allow(null, '').optional(),
  claimType: Joi.string().valid('pickup_qc', 'instant_claim').required(),
  customerNote: Joi.string().max(1000).allow(null, '').optional(),
});

export const qcDecisionSchema = Joi.object({
  decision: Joi.string().valid('pass', 'fail').required(),
  note: Joi.string().max(500).allow(null, '').optional(),
});

export const refundInitiateSchema = Joi.object({
  orderId: objectId.required(),
  amount: Joi.number().positive().max(1000000).required(),
  reason: Joi.string().valid(
    'order_cancelled', 'return_qc_passed', 'instant_claim_approved',
    'delivery_failed', 'admin_override'
  ).required(),
  destination: Joi.string().valid('wallet', 'original_method').allow(null, '').optional(),
  paymentId: objectId.allow(null, '').optional(),
  idempotencyKey: Joi.string().max(80).allow(null, '').optional(),
});

export const slotReserveSchema = Joi.object({
  id: objectId.required(),
});

// ---- Phase 3.5: rider app ----
export const riderActionSchema = Joi.object({
  package_verified: Joi.boolean().optional(),
  pod_type: Joi.string().valid('otp', 'photo', 'signature').optional(),
  pod_reference: Joi.string().max(512).allow(null, '').optional(),
  reason: Joi.string().max(300).allow(null, '').optional(),
  fail_reason: Joi.string().max(300).allow(null, '').optional(),
});

export const riderAvailabilitySchema = Joi.object({
  status: Joi.string().valid('available', 'busy', 'offline').required(),
});

export const deliveryListQuerySchema = Joi.object({
  status: Joi.string().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

// ---- Phase 3.5: policies ----
export const feePolicySchema = Joi.object({
  name: Joi.string().max(120).optional(),
  baseFee: Joi.number().min(0).required(),
  freeDeliveryThreshold: Joi.number().min(0).allow(null).optional(),
  expressSurgeMultiplier: Joi.number().min(1).allow(null).optional(),
  distanceFeePerKm: Joi.number().min(0).allow(null).optional(),
  effectiveFrom: Joi.date().optional(),
  effectiveTo: Joi.date().optional(),
  isActive: Joi.boolean().optional(),
});

export const taxPolicySchema = Joi.object({
  categoryId: objectId.required(),
  gstSlabPct: Joi.number().min(0).max(100).required(),
  hsnCode: Joi.string().max(16).allow(null, '').optional(),
  effectiveFrom: Joi.date().optional(),
  effectiveTo: Joi.date().optional(),
});

export const couponSchema = Joi.object({
  code: Joi.string().max(32).required(),
  discountType: Joi.string().valid('flat', 'percent').required(),
  value: Joi.number().min(0).required(),
  minCartValue: Joi.number().min(0).allow(null).optional(),
  maxDiscountCap: Joi.number().min(0).allow(null).optional(),
  usageLimitPerCustomer: Joi.number().integer().min(1).allow(null).optional(),
  validFrom: Joi.date().allow(null).optional(),
  validTo: Joi.date().allow(null).optional(),
  isPlatformWide: Joi.boolean().optional(),
});

export const refundPolicySchema = Joi.object({
  refundDeliveryFeeWhen: Joi.string().valid('never', 'full_order_return_only', 'always').required(),
  refundFeePct: Joi.number().min(0).max(100).optional(),
});

export const couponPreviewSchema = Joi.object({
  code: Joi.string().max(32).required(),
  cartSubtotal: Joi.number().min(0).required(),
});

// ---- Phase 3.5: cart coupon ----
export const cartCouponSchema = Joi.object({
  code: Joi.string().max(32).required(),
});

// ---- Phase 3.5: forecast ----
export const forecastBodySchema = Joi.object({
  hubId: objectId.required(),
  date: Joi.string().regex(/^\d{4}-\d{2}-\d{2}$/).required(),
  pickerCount: Joi.number().integer().min(0).allow(null).optional(),
  riderCount: Joi.number().integer().min(0).allow(null).optional(),
  dryRun: Joi.boolean().optional(),
});
