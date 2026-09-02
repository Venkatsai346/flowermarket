/**
 * Single source of truth for enumerations and app-wide constants.
 *
 * Centralizing enums matters for a scalable system:
 *  - one place to evolve values (no magic strings scattered across files)
 *  - models, validators and API docs stay in lock-step
 *  - safe to expose select lists to the React Native client later
 */

// ---------------- Generic ----------------
export const STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  DELETED: 'deleted', // soft-delete marker
});

// active/inactive/archived — used by categories, brands, variants, images, inventory
export const ENTITY_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived',
});

// ---------------- Tenancy ----------------
export const TENANT_PLAN = Object.freeze({
  FREE: 'free',
  PRO: 'pro',
  ENTERPRISE: 'enterprise',
});

// ---------------- Users ----------------
export const USER_ROLES = Object.freeze({
  CUSTOMER: 'customer', // default — same semantics as BigBasket end user
  VENDOR: 'vendor', // future: sell on the market (part of multi-tenant roadmap)
  ADMIN: 'admin', // platform / tenant admin
  SUPER_ADMIN: 'super_admin', // platform operator across tenants
  PICKER: 'picker', // dark-store picker (fulfillment)
  RIDER: 'rider', // delivery rider
});

export const USER_STATUS = Object.freeze({
  ...STATUS,
  VERIFICATION_PENDING: 'verification_pending', // signed up but OTP/email not yet verified
  BLOCKED: 'blocked', // admin action; blocked users cannot log in
});

export const LOGIN_METHOD = Object.freeze({
  PHONE_OTP: 'phone_otp',
  EMAIL_PASSWORD: 'email_password',
  GOOGLE: 'google',
  APPLE: 'apple',
});

export const GENDER = Object.freeze({
  MALE: 'male',
  FEMALE: 'female',
  OTHER: 'other',
  PREFER_NOT_TO_SAY: 'prefer_not_to_say',
});

// ---------------- Addresses ----------------
export const ADDRESS_TYPE = Object.freeze({
  HOME: 'home',
  WORK: 'work',
  OTHER: 'other',
});

export const ADDRESS_TAG = Object.freeze({
  HOME: 'home',
  WORK: 'work',
  OTHER: 'other',
});

/**
 * IMPORTANT (pincode constraint):
 * We keep a dedicated `ServiceablePincode` collection that governs whether an
 * address is deliverable. It also maps the pincode to a service area (Zone)
 * so delivery slots, timing and fees can be derived without free-text matching.
 */
export const ADDRESS_VERIFICATION_STATUS = Object.freeze({
  UNVERIFIED: 'unverified',
  SERVICEABLE: 'serviceable', // pincode is serviceable AND geo-verified (if geo enabled)
  UN_SERVICEABLE: 'unserviceable',
  GEO_MISMATCH: 'geo_mismatch', // pincode says A, geo-coords say B
});

// ---------------- Locations ----------------
export const LOCATION_TYPE = Object.freeze({
  COUNTRY: 'country',
  STATE: 'state',
  CITY: 'city',
  AREA: 'area',
  PINCODE: 'pincode',
});

export const LOCATION_STATUS = Object.freeze(STATUS);

export const GEO_SOURCE = Object.freeze({
  USER: 'user',
  MANUAL: 'manual',
  GOOGLE: 'google',
  PLACES: 'places',
});

// ---------------- Products ----------------
export const PRODUCT_TYPE = Object.freeze({
  FRESH_FLOWER: 'fresh_flower',
  DRIED_FLOWER: 'dried_flower',
  ARTIFICIAL_FLOWER: 'artificial_flower',
  FLOWER_BOUQUET: 'flower_bouquet',
  FLOWER_ARRANGEMENT: 'flower_arrangement',
  PLANT: 'plant',
  SEED: 'seed',
  GARDENING_TOOL: 'gardening_tool',
  FLORAL_ACCESSORY: 'floral_accessory',
  GIFT: 'gift',
  OTHER: 'other',
});

export const PRODUCT_STATUS = Object.freeze(ENTITY_STATUS);

export const AVAILABILITY_STATUS = Object.freeze({
  IN_STOCK: 'in_stock',
  LOW_STOCK: 'low_stock',
  OUT_OF_STOCK: 'out_of_stock',
  DISCONTINUED: 'discontinued',
});

export const LISTING_STATUS = Object.freeze({
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
});

export const SELLING_UNIT = Object.freeze({
  PIECE: 'piece',
  STEM: 'stem',
  BUNCH: 'bunch',
  BOUQUET: 'bouquet',
  BOX: 'box',
  BUCKET: 'bucket',
  KILOGRAM: 'kilogram',
  GRAM: 'gram',
  PACK: 'pack',
  POT: 'pot', // plants
});

export const PRICE_CURRENCY = Object.freeze({
  INR: 'INR',
});

export const DIMENSION_UNIT = Object.freeze({
  CM: 'cm',
  IN: 'in',
});

export const WEIGHT_UNIT = Object.freeze({
  G: 'g',
  KG: 'kg',
});

// ---------------- Inventory ----------------
export const INVENTORY_OP_TYPE = Object.freeze({
  PURCHASE: 'purchase',
  SALE: 'sale',
  ADJUSTMENT: 'adjustment',
  DAMAGE: 'damage',
  RETURN: 'return',
  TRANSFER_IN: 'transfer_in',
  TRANSFER_OUT: 'transfer_out',
  EXPIRY: 'expiry',
});

// ---------------- Slots & Delivery ----------------
export const SLOT_WINDOW_TYPE = Object.freeze({
  NORMAL: 'normal',
  EXPRESS: 'express',
  SAME_DAY: 'same_day',
  NEXT_DAY: 'next_day',
  SCHEDULED: 'scheduled',
});

export const DELIVERY_TYPE = Object.freeze({
  STANDARD: 'standard',
  EXPRESS: 'express',
  SCHEDULED: 'scheduled',
});

export const DELIVERY_FEE_TYPE = Object.freeze({
  FREE: 'free',
  FLAT: 'flat',
  DISTANCE_BASED: 'distance_based',
  WEIGHT_BASED: 'weight_based',
});

export const ORDER_SOURCE = Object.freeze({
  APP: 'app',
  WEB: 'web',
});

// ============================================================
// ORDER LIFECYCLE (Phase 3) — state machines per the architecture doc
// ============================================================

// ---- Order status machine (saga-orchestrated) ----
export const ORDER_STATUS = Object.freeze({
  CREATED: 'created', // order doc created, before payment
  PAYMENT_PENDING: 'payment_pending', // charge in flight
  CONFIRMED: 'confirmed', // payment OK + inventory committed + slot confirmed
  PICKING: 'picking', // picker working the fulfillment task
  PACKED: 'packed', // picked & packed, awaiting rider
  OUT_FOR_DELIVERY: 'out_for_delivery', // rider assigned & en route
  DELIVERED: 'delivered', // POD captured
  DELIVERY_FAILED: 'delivery_failed', // retryable delivery failure
  CANCELLED: 'cancelled', // customer/ops cancel; reverse-saga executed
  // return sub-states (order-level mirror of the return request)
  RETURN_REQUESTED: 'return_requested',
  RETURN_APPROVED: 'return_approved',
  RETURN_REJECTED: 'return_rejected',
  RETURN_PICKED_UP: 'return_picked_up',
  QC_PASSED: 'qc_passed',
  QC_FAILED: 'qc_failed',
  REFUND_INITIATED: 'refund_initiated',
  REFUNDED: 'refunded',
  REFUND_REJECTED: 'refund_rejected',
});

export const ORDER_CANCELLATION_REASON = Object.freeze({
  CUSTOMER_REQUESTED: 'customer_requested',
  CHANGED_MIND: 'changed_mind',
  DUPLICATE_ORDER: 'duplicate_order',
  PAYMENT_FAILED: 'payment_failed',
  STOCK_UNAVAILABLE: 'stock_unavailable',
  DELIVERY_FAILED_MAX_RETRIES: 'delivery_failed_max_retries',
  ADMIN_FORCE: 'admin_force',
  SLOT_EXPIRED: 'slot_expired',
  OTHER: 'other',
});

// ---- Payment ----
export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
});

export const PAYMENT_METHOD = Object.freeze({
  UPI: 'upi',
  CARD: 'card',
  NETBANKING: 'netbanking',
  WALLET: 'wallet',
  COD: 'cod',
});

export const PAYMENT_PROVIDER = Object.freeze({
  MOCK: 'mock', // dev/test gateway
  RAZORPAY: 'razorpay', // production (adapter-ready)
});

export const PAYMENT_TRANSACTION_TYPE = Object.freeze({
  CHARGE: 'charge',
  REFUND: 'refund',
});

export const PAYMENT_TRANSACTION_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
});

// ---- Slot reservation ----
export const SLOT_RESERVATION_STATUS = Object.freeze({
  HELD: 'held', // checkout started, capacity locked (TTL-limited)
  CONFIRMED: 'confirmed', // payment succeeded, order confirmed
  EXPIRED: 'expired', // hold TTL lapsed (sweep)
  RELEASED: 'released', // released by cancellation / compensation
});

export const SLOT_HOLD_TTL_SECONDS = 10 * 60; // 10-minute hold per the doc

// ---- Fulfillment ----
export const FULFILLMENT_TASK_STATUS = Object.freeze({
  QUEUED: 'queued',
  PICKING: 'picking',
  PACKED: 'packed',
  FAILED: 'failed',
});

export const DELIVERY_ASSIGNMENT_STATUS = Object.freeze({
  PENDING_ACCEPT: 'pending_accept', // rider notified; awaiting accept/reject
  ACCEPTED: 'accepted', // rider confirmed; rider -> BUSY
  AT_HUB: 'at_hub', // rider at dark store; awaiting package verification
  IN_TRANSIT: 'in_transit', // left hub; order -> OUT_FOR_DELIVERY
  ARRIVED: 'arrived', // at customer door
  DELIVERED: 'delivered', // POD captured; order -> DELIVERED
  FAILED: 'failed', // delivery failed; triggers retry-or-reschedule
  CANCELLED: 'cancelled', // superseded (manual reassignment / order cancelled)
});

/** Rider availability (drives assignment eligibility). */
export const RIDER_AVAILABILITY = Object.freeze({
  AVAILABLE: 'available',
  BUSY: 'busy',
  OFFLINE: 'offline',
});

/** Seconds a rider has to accept before the assignment auto-reassigns. */
export const RIDER_ACCEPT_TTL_SECONDS = 45;

/** Max riders a single assignment can be rejected by before manual escalation. */
export const RIDER_REJECT_CAP = 10;

// ---- Discount / coupon policies ----
export const DISCOUNT_TYPE = Object.freeze({
  FLAT: 'flat',
  PERCENT: 'percent',
});

export const COUPON_STATUS = Object.freeze({
  ACTIVE: 'active',
  DISABLED: 'disabled',
  EXPIRED: 'expired',
});

// ---- Refund fee policy (TenantRefundPolicy.refundDeliveryFeeWhen) ----
export const REFUND_FEE_POLICY = Object.freeze({
  NEVER: 'never', // fee is never refunded (service was rendered)
  FULL_ORDER_RETURN_ONLY: 'full_order_return_only', // refund fee only when the WHOLE order returns
  ALWAYS: 'always', // fee refunded on any return
});

// ---- Slot forecasting ----
export const FORECAST_DEFAULTS = Object.freeze({
  HEADROOM_MULTIPLIER: 1.5, // predicted demand × headroom before capping
  FLOOR_CAPACITY: 5, // never forecast below this
  HISTORY_DAYS: 60, // lookback window for the moving-average baseline
  PICK_ITEMS_PER_HOUR: 20, // physical throughput: picker × items/hr
  DELIVERIES_PER_RIDER_PER_SLOT: 15, // physical throughput: rider × deliveries/slot
  WINDOW_HOURS: 3, // avg slot window length used for physical-limit math
});

export const POD_TYPE = Object.freeze({
  OTP: 'otp',
  PHOTO: 'photo',
  SIGNATURE: 'signature',
});

// ---- Admin dashboard (Phase 4) ----
export const INVENTORY_ADJUSTMENT_TYPE = Object.freeze({
  RESTOCK: 'restock', // new stock arrived (procurement)
  SHRINKAGE: 'shrinkage', // damaged / expired / lost
  AUDIT_CORRECTION: 'audit_correction', // counted stock differs from system
  RETURN_RESTOCK: 'return_restock', // goods returned & back on the shelf
});

export const INVENTORY_HEALTH = Object.freeze({
  IN_STOCK: 'in_stock',
  LOW_STOCK: 'low_stock',
  OUT_OF_STOCK: 'out_of_stock',
});

export const ADMIN_DEFAULTS = Object.freeze({
  LOW_STOCK_THRESHOLD: 5, // qtyAvailable <= threshold => low_stock
  TOP_PRODUCTS_LIMIT: 20, // analytics rollup / top-products cap
});

// ---- Phase 4b: notifications & exports ----
export const NOTIFICATION_CHANNEL = Object.freeze({
  PUSH: 'push',
  EMAIL: 'email',
  SMS: 'sms',
});

export const NOTIFICATION_STATUS = Object.freeze({
  PENDING: 'pending', // enqueued, not yet sent
  SENDING: 'sending', // worker in flight
  SENT: 'sent', // all channels delivered
  FAILED: 'failed', // one or more channels failed (retryable)
  READ: 'read', // customer opened it (inbox state, terminal)
});

export const NOTIFICATION_PRIORITY = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
});

export const DEVICE_PLATFORM = Object.freeze({
  ANDROID: 'android',
  IOS: 'ios',
  WEB: 'web',
});

export const PUSH_PROVIDER = Object.freeze({
  FCM: 'fcm',
  APNS: 'apns',
});

export const EXPORT_JOB_TYPE = Object.freeze({
  ANALYTICS_DAILY: 'analytics_daily',
  ORDERS: 'orders',
  INVENTORY: 'inventory',
  PRODUCTS: 'products',
  USERS: 'users',
});

export const EXPORT_JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
});

// ---- Returns & refunds ----
export const RETURN_CLAIM_TYPE = Object.freeze({
  PICKUP_QC: 'pickup_qc', // standard return: pickup + quality check
  INSTANT_CLAIM: 'instant_claim', // perishable quality guarantee: no pickup
});

export const RETURN_REQUEST_STATUS = Object.freeze({
  REQUESTED: 'requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PICKED_UP: 'picked_up',
  QC_PASSED: 'qc_passed',
  QC_FAILED: 'qc_failed',
  REFUND_INITIATED: 'refund_initiated',
  REFUNDED: 'refunded',
  REFUND_REJECTED: 'refund_rejected',
});

export const RETURN_QC_STATUS = Object.freeze({
  PENDING: 'pending',
  PASSED: 'passed',
  FAILED: 'failed',
});

export const REFUND_DESTINATION = Object.freeze({
  WALLET: 'wallet', // instant, default for small/low-risk
  ORIGINAL_METHOD: 'original_method', // gateway round-trip (T+2..T+7)
});

export const REFUND_TRANSACTION_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
});

export const REFUND_REASON = Object.freeze({
  ORDER_CANCELLED: 'order_cancelled',
  RETURN_QC_PASSED: 'return_qc_passed',
  INSTANT_CLAIM_APPROVED: 'instant_claim_approved',
  DELIVERY_FAILED: 'delivery_failed',
  ADMIN_OVERRIDE: 'admin_override',
});

// ---- Wallet ----
export const WALLET_TXN_TYPE = Object.freeze({
  CREDIT: 'credit',
  DEBIT: 'debit',
});

export const WALLET_TXN_REASON = Object.freeze({
  REFUND: 'refund',
  GOODWILL: 'goodwill',
  ORDER_PAYMENT: 'order_payment',
  ADJUSTMENT: 'adjustment',
});

// ---- Cart ----
export const CART_STATUS = Object.freeze({
  ACTIVE: 'active',
  CHECKED_OUT: 'checked_out',
  ABANDONED: 'abandoned',
});

export const CART_TTL_SECONDS = 30 * 24 * 60 * 60; // 30-day abandoned-cart TTL

export const CART_ITEM_LIMIT = 50; // bounded items per cart (no unbounded arrays)

// ---------------- Misc ----------------
export const HASH_ALGO = Object.freeze({
  SHA256: 'sha256',
});

export const ENV_SCOPES = Object.freeze({
  DEV: 'dev',
  PROD: 'prod',
});

// ============================================================
// CATALOG (Phase 2) — multi-tenant master/listing split
// ============================================================

// ---- ProductMaster (global product identity) ----
export const PRODUCT_MASTER_STATUS = Object.freeze({
  PENDING_REVIEW: 'pending_review', // proposed by a tenant, awaiting admin approval
  ACTIVE: 'active', // approved & globally visible
  REJECTED: 'rejected', // failed review (reason in review.note)
  DEPRECATED: 'deprecated', // soft-removed globally; cascades listings to INACTIVE
});

// ---- TenantProduct (tenant-scoped sellable listing) ----
export const TENANT_LISTING_STATUS = Object.freeze({
  DRAFT: 'draft', // created but not yet listed
  ACTIVE: 'active', // sellable in this tenant
  INACTIVE: 'inactive', // paused / deactivated by the tenant
  OUT_OF_STOCK: 'out_of_stock', // stock snapshot zeroed (derived from inventory)
});

// ---- Category attribute schema field types ----
export const ATTRIBUTE_FIELD_TYPE = Object.freeze({
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  SELECT: 'select',
  DATE: 'date',
});

// ---- Product variants (weight / pack-size / stem-count / color ...) ----
export const VARIANT_TYPE = Object.freeze({
  WEIGHT: 'weight',
  PACK_SIZE: 'pack_size',
  STEM_COUNT: 'stem_count',
  COLOR: 'color',
  SIZE: 'size',
  FLAVOR: 'flavor',
  OTHER: 'other',
});

// ---- ProductChangeRequest (field-ownership approval workflow) ----
export const CHANGE_REQUEST_TYPE = Object.freeze({
  CREATE_MASTER: 'create_master', // tenant proposes a brand-new global SKU
  UPDATE_GLOBAL_FIELDS: 'update_global_fields', // tenant edits title/images/category/attrs
  ADD_VARIANT: 'add_variant',
  UPDATE_IMAGES: 'update_images',
  UPDATE_ATTRIBUTES: 'update_attributes',
  DEACTIVATE_MASTER: 'deactivate_master',
});

export const CHANGE_REQUEST_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  NEEDS_CHANGES: 'needs_changes', // admin asks the tenant to revise & resubmit
  CANCELLED: 'cancelled', // tenant withdrew the request
});

// ---- Audit ----
export const AUDIT_ACTION = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  STATUS_CHANGE: 'status_change',
  PRICE_CHANGE: 'price_change',
  STOCK_CHANGE: 'stock_change',
  APPROVE: 'approve',
  REJECT: 'reject',
  DEPRECATE: 'deprecate',
  VERIFY: 'verify',
  IMPORT: 'import',
  RESERVE: 'reserve',
  RELEASE: 'release',
  // ---- Phase 4: admin dashboard actions ----
  ADJUST: 'adjust', // inventory manual adjustment
  OVERRIDE: 'override', // slot capacity override
  ACTIVATE: 'activate',
  DEACTIVATE: 'deactivate',
  PINCODES: 'pincodes', // hub serviceable pincode change
  REOPEN: 'reopen',
  CLOSE: 'close',
  ROLE_CHANGE: 'role_change',
  OTHER: 'other',
});

export const AUDIT_ACTOR_TYPE = Object.freeze({
  CUSTOMER: 'customer', // end customer acting on their own resources
  TENANT: 'tenant', // a user acting inside a tenant scope
  ADMIN: 'admin', // platform admin acting globally
  SYSTEM: 'system', // automated jobs / schedulers
});

// ---- Catalog event outbox ----
export const CATALOG_EVENT_TYPE = Object.freeze({
  PRODUCT_CREATED: 'product_created',
  PRODUCT_UPDATED: 'product_updated',
  PRODUCT_MASTER_UPDATED: 'product_master_updated',
  PRODUCT_DEACTIVATED: 'product_deactivated',
  TENANT_PRODUCT_CREATED: 'tenant_product_created',
  TENANT_PRODUCT_UPDATED: 'tenant_product_updated',
  PRICE_CHANGED: 'price_changed',
  STOCK_CHANGED: 'stock_changed',
  INVENTORY_RESERVED: 'inventory_reserved',
  INVENTORY_RELEASED: 'inventory_released',
  CATEGORY_UPDATED: 'category_updated',
  BRAND_UPDATED: 'brand_updated',
  // ---- order lifecycle (Phase 3) ----
  ORDER_CREATED: 'order_created',
  ORDER_CONFIRMED: 'order_confirmed',
  ORDER_OUT_FOR_DELIVERY: 'order_out_for_delivery',
  ORDER_DELIVERED: 'order_delivered',
  ORDER_CANCELLED: 'order_cancelled',
  RIDER_ARRIVED: 'rider_arrived',
  RETURN_CREATED: 'return_created',
  RETURN_REFUND_INITIATED: 'return_refund_initiated',
  REFUND_COMPLETED: 'refund_completed',
  CHANGE_REQUEST_REVIEWED: 'change_request_reviewed',
});

export const OUTBOX_STATUS = Object.freeze({
  PENDING: 'pending',
  PUBLISHING: 'publishing',
  PUBLISHED: 'published',
  FAILED: 'failed',
});

// ---- Price history ----
export const PRICE_CHANGE_REASON = Object.freeze({
  MANUAL: 'manual',
  PROMOTION: 'promotion',
  BULK: 'bulk',
  ADMIN_OVERRIDE: 'admin_override',
  RESET: 'reset',
});

export const PRICE_CHANGE_SOURCE = Object.freeze({
  TENANT: 'tenant',
  ADMIN: 'admin',
});

// ---- Brand ----
export const BRAND_VERIFICATION_STATUS = Object.freeze({
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
});

export const ENTITY_STATUS2 = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
});


// ================= Phase 5: multi-tenant marketplace =================

export const VENDOR_APPLICATION_STATUS = Object.freeze({
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const VENDOR_STATUS = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
});

export const SUBSCRIPTION_STATUS = Object.freeze({
  TRIAL: 'trial',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELLED: 'cancelled',
});

export const INVOICE_STATUS = Object.freeze({
  DRAFT: 'draft',
  OPEN: 'open',
  PAID: 'paid',
  OVERDUE: 'overdue',
  VOID: 'void',
});

export const INVOICE_LINE_TYPE = Object.freeze({
  SUBSCRIPTION: 'subscription',
  COMMISSION: 'commission',
  ADJUSTMENT: 'adjustment',
});

export const STORE_ONBOARDING_STATUS = Object.freeze({
  REGISTERED: 'registered',
  ACTIVE: 'active',
});

export const PLATFORM_DAILY_STATUS = Object.freeze({
  READY: 'ready',
});

// ---------------- Media uploads (images & videos) ----------------
export const MEDIA_TYPE = Object.freeze({
  IMAGE: 'image',
  VIDEO: 'video',
});

export const MEDIA_STATUS = Object.freeze({
  PENDING: 'pending', // presigned, not yet uploaded/confirmed
  READY: 'ready',     // uploaded + verified, URL usable
  FAILED: 'failed',   // verification failed (size/type mismatch)
  DELETED: 'deleted', // soft-deleted
});

export const MEDIA_PURPOSE = Object.freeze({
  PRODUCT_IMAGE: 'product_image',
  CATEGORY_IMAGE: 'category_image',
  BRAND_LOGO: 'brand_logo',
  STORE_LOGO: 'store_logo',
  STORE_BANNER: 'store_banner',
  PRODUCT_VIDEO: 'product_video',
  OTHER: 'other',
});
