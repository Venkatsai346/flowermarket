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

  // ---- Phase 6.2/M3: GST filing working papers ----
  GSTR1_B2B: 'gstr1_b2b',
  GSTR1_B2CS: 'gstr1_b2cs',
  GSTR1_HSN: 'gstr1_hsn',
  GSTR1_CDNR: 'gstr1_cdnr',
  GSTR8_TCS: 'gstr8_tcs',
  TDS_194O: 'tds_194o',
  SALES_REGISTER: 'sales_register',
  PAYOUT_STATEMENT: 'payout_statement',
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

  // ---- Phase 3.5: rider delivery state machine ----
  ACCEPT: 'accept',
  DEPART: 'depart',
  ARRIVE: 'arrive',
  COMPLETE: 'complete',
  FAIL: 'fail',

  // ---- Phase 5: billing & marketplace ops ----
  SUBSCRIBE: 'subscribe',
  PLAN_CHANGE: 'plan_change',
  INVOICE_GENERATED: 'invoice_generated',
  INVOICE_PAID: 'invoice_paid',
  INVOICE_VOID: 'invoice_void',
  SYNC_VENDOR_PRODUCTS: 'sync_vendor_products',
  PLATFORM_ROLLUP: 'platform_rollup',
  NIGHTLY: 'nightly',
  MARKETPLACE_NIGHTLY: 'marketplace_nightly',

  // ---- Phase 6.1: financial ledger ----
  LEDGER_POST: 'ledger_post',
  LEDGER_REVERSE: 'ledger_reverse',
  LEDGER_REPAIR: 'ledger_repair',

  // ---- Phase 6.2: GST documents ----
  INVOICE_ISSUE: 'invoice_issue',
  INVOICE_CANCEL: 'invoice_cancel',
  CREDIT_NOTE_ISSUE: 'credit_note_issue',
  TAX_REGISTRATION_UPDATE: 'tax_registration_update',
  RATE_OVERRIDE: 'rate_override',

  // ---- Phase 6.3: vendor payouts ----
  PAYOUT_COMPUTE: 'payout_compute',
  PAYOUT_APPROVE: 'payout_approve',
  PAYOUT_REJECT: 'payout_reject',
  PAYOUT_SUBMIT: 'payout_submit',
  PAYOUT_SETTLE: 'payout_settle',
  PAYOUT_FAIL: 'payout_fail',
  PAYOUT_REVERSE: 'payout_reverse',
  PAYOUT_HOLD: 'payout_hold',
  PAYOUT_ADJUST: 'payout_adjust',
  KYC_REVIEW: 'kyc_review',
  BANK_VERIFY: 'bank_verify',

  // ---- Phase 6.4: domains ----
  DOMAIN_ADD: 'domain_add',
  DOMAIN_VERIFY: 'domain_verify',
  DOMAIN_REMOVE: 'domain_remove',
  DOMAIN_PRIMARY: 'domain_primary',

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

// ============================================================
// PHASE 6.1 — FINANCIAL LEDGER (double-entry)
// ============================================================

/**
 * Account types decide the NATURAL BALANCE side:
 *   asset/expense  -> debit-positive   (balance = debits − credits)
 *   liability/income -> credit-positive (balance = credits − debits)
 */
export const LEDGER_ACCOUNT_TYPE = Object.freeze({
  ASSET: 'asset',
  LIABILITY: 'liability',
  INCOME: 'income',
  EXPENSE: 'expense',
});

/** Journal kinds — one per business event that moves money. */
export const LEDGER_JOURNAL_KIND = Object.freeze({
  SALE_CAPTURED: 'sale_captured',       // order confirmed: customer money recognised
  PSP_SETTLED: 'psp_settled',           // gateway settled into our bank
  REFUND_ISSUED: 'refund_issued',       // refund to wallet or original method
  PAYOUT_INITIATED: 'payout_initiated', // money sent to a vendor
  PAYOUT_REVERSED: 'payout_reversed',   // bank returned it
  TDS_DEDUCTED: 'tds_deducted',
  COMMISSION_INVOICED: 'commission_invoiced',
  ADJUSTMENT: 'adjustment',             // manual, reason-coded, audited
});

/**
 * Global (unscoped) account codes. Scoped accounts append an owner id:
 * `vendor_payable:{vendorId}`, `tenant_payable:{tenantId}`, … — built with
 * `ledgerAccounts.*` helpers in services/ledger.service.js so the string
 * format lives in exactly one place.
 */
export const LEDGER_ACCOUNT = Object.freeze({
  GATEWAY_CLEARING: 'gateway_clearing',                 // asset: captured by PSP, not yet settled
  BANK: 'bank',                                         // asset: our settlement account
  PLATFORM_COMMISSION_INCOME: 'platform_commission_income',
  TCS_PAYABLE: 'tcs_payable',                           // liability: collected u/s 52
  TDS_PAYABLE: 'tds_payable',                           // liability: deducted u/s 194-O
  CUSTOMER_WALLET_LIABILITY: 'customer_wallet_liability',
  ROUNDING_DIFFERENCE: 'rounding_difference',           // expense: never expected to be non-zero
});

/** Prefixes for owner-scoped accounts. */
export const LEDGER_ACCOUNT_PREFIX = Object.freeze({
  VENDOR_PAYABLE: 'vendor_payable',
  TENANT_PAYABLE: 'tenant_payable',
  GST_OUTPUT_PAYABLE: 'gst_output_payable',
  REFUND_CLAWBACK: 'refund_clawback',
});


// ============================================================
// PHASE 6.2 — GST / TAX INVOICING
// ============================================================

/**
 * Nature of supply drives how a line is REPORTED, not just how it is taxed.
 * A flower marketplace routinely mixes these on one invoice: fresh cut flowers
 * and live plants are nil-rated, while pots, tools and artificial flowers are
 * taxable — so rate-wise (HSN) summaries are mandatory, not optional.
 */
export const TAX_NATURE_OF_SUPPLY = Object.freeze({
  TAXABLE: 'taxable',
  NIL_RATED: 'nil_rated',
  EXEMPT: 'exempt',
  ZERO_RATED: 'zero_rated', // exports / SEZ
  NON_GST: 'non_gst',
});

export const TAX_DOC_TYPE = Object.freeze({
  INVOICE: 'invoice',
  CREDIT_NOTE: 'credit_note',
});

/**
 * DRAFT -> ISSUED -> CANCELLED. There is deliberately no "edit" state:
 * an issued document is immutable and a mistake is corrected by a credit note.
 * A cancelled document keeps its number forever (numbering must stay gapless).
 */
export const TAX_DOC_STATUS = Object.freeze({
  DRAFT: 'draft',
  ISSUED: 'issued',
  CANCELLED: 'cancelled',
});

export const EINVOICE_STATUS = Object.freeze({
  NOT_APPLICABLE: 'not_applicable',
  PENDING: 'pending',
  GENERATED: 'generated',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

export const TAX_REGISTRATION_TYPE = Object.freeze({
  REGULAR: 'regular',
  COMPOSITION: 'composition',
  UNREGISTERED: 'unregistered',
});

export const TAX_OWNER_TYPE = Object.freeze({
  PLATFORM: 'platform',
  TENANT: 'tenant',
  VENDOR: 'vendor',
});

/** Statutory collection rates — DATA, because they change by notification. */
export const STATUTORY_RATE_KIND = Object.freeze({
  TCS_GST_52: 'tcs_gst_52',   // e-commerce operator TCS, GST s.52 (GSTR-8)
  TDS_194O: 'tds_194o',       // income-tax deduction, s.194-O (26Q)
});

export const CREDIT_NOTE_REASON = Object.freeze({
  RETURN: 'return',
  CANCELLATION: 'cancellation',
  PRICE_REVISION: 'price_revision',
  DEFICIENCY: 'deficiency',
  OTHER: 'other',
});

// ============================================================
// PHASE 6.3 — VENDOR PAYOUTS
// ============================================================

/**
 * A payout line's journey. Money is only ever paid for lines in ELIGIBLE
 * state: accrued means "earned but still at risk of return", held means an
 * operator or a dispute stopped it.
 */
export const PAYOUT_LINE_STATE = Object.freeze({
  ACCRUED: 'accrued',     // order confirmed; return window still open
  ELIGIBLE: 'eligible',   // return window closed (and cash settled) — payable
  HELD: 'held',           // blocked: dispute, KYC, manual hold
  BATCHED: 'batched',     // assigned to a payout batch
  PAID: 'paid',
  REVERSED: 'reversed',   // refunded before payout, or clawed back after
});

export const PAYOUT_HOLD_REASON = Object.freeze({
  DISPUTE: 'dispute',
  KYC_PENDING: 'kyc_pending',
  BANK_UNVERIFIED: 'bank_unverified',
  FRAUD_REVIEW: 'fraud_review',
  MANUAL: 'manual',
  NEGATIVE_BALANCE: 'negative_balance',
});

/**
 * Batch state machine. Approval is a distinct, role-gated step because this is
 * the one place in the platform where money leaves the building.
 */
export const PAYOUT_STATE = Object.freeze({
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  PAID: 'paid',
  FAILED: 'failed',
  REVERSED: 'reversed',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
});

export const PAYOUT_METHOD = Object.freeze({
  BANK: 'bank',
  UPI: 'upi',
});

export const PAYOUT_TRANSFER_MODE = Object.freeze({
  IMPS: 'IMPS',
  NEFT: 'NEFT',
  RTGS: 'RTGS',
  UPI: 'UPI',
});

export const KYC_STATUS = Object.freeze({
  NOT_SUBMITTED: 'not_submitted',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const BANK_VERIFICATION_STATUS = Object.freeze({
  UNVERIFIED: 'unverified',
  PENDING: 'pending',
  VERIFIED: 'verified',
  FAILED: 'failed',
});

export const PAYOUT_ADJUSTMENT_REASON = Object.freeze({
  PENALTY_SLA: 'penalty_sla',
  PENALTY_QUALITY: 'penalty_quality',
  GOODWILL: 'goodwill',
  CORRECTION: 'correction',
  CHARGEBACK: 'chargeback',
  OTHER: 'other',
});

// ============================================================
// PHASE 6.4 — DOMAIN ROUTING
// ============================================================

export const DOMAIN_KIND = Object.freeze({
  SUBDOMAIN: 'subdomain', // {slug}.{root} — covered by the wildcard cert
  CUSTOM: 'custom',       // the store's own domain — needs DNS proof + TLS
});

export const DOMAIN_VERIFICATION_STATUS = Object.freeze({
  PENDING: 'pending',
  VERIFIED: 'verified',
  FAILED: 'failed',
});

export const TLS_STATUS = Object.freeze({
  NONE: 'none',
  PROVISIONING: 'provisioning',
  ACTIVE: 'active',
  FAILED: 'failed',
});

/** How the tenant for a request was decided — recorded for auditing. */
export const TENANT_RESOLUTION_SOURCE = Object.freeze({
  HOST_SUBDOMAIN: 'host_subdomain',
  HOST_CUSTOM: 'host_custom',
  HEADER: 'header',
  TOKEN: 'token',
  DEFAULT: 'default',
  FALLBACK: 'fallback',
});
