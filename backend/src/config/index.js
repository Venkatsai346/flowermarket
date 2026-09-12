import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const env = process.env.NODE_ENV || 'development';

/**
 * Centralized, validated app configuration.
 * Every module should import config from here instead of reading process.env.
 */
const config = {
  env,
  isDev: env === 'development',
  isProd: env === 'production',
  isTest: env === 'test',

  port: Number(process.env.PORT) || 4000,
  appName: process.env.APP_NAME || 'Flower Market API',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/flower_market',

  // ---- MongoDB connection pool tuning (Phase 7.7.12) ----
  mongoPool: {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 100,
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 5,
    maxIdleTimeMS: Number(process.env.MONGO_MAX_IDLE_TIME_MS) || 60000,
    waitQueueTimeoutMS: Number(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS) || 10000,
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 5000,
    heartbeatFrequencyMS: Number(process.env.MONGO_HEARTBEAT_FREQUENCY_MS) || 10000,
    compressors: (process.env.MONGO_COMPRESSORS || 'zstd,zlib').split(','),
    readPreference: process.env.MONGO_READ_PREFERENCE || 'primaryPreferred',
    retryWrites: process.env.MONGO_RETRY_WRITES !== 'false',
    retryReads: process.env.MONGO_RETRY_READS !== 'false',
  },

  // ---- Redis (optional: rate limiting, caching, job queues) ----
  // When REDIS_URL is not set, all Redis features fall back to in-memory.
  // Production should always have Redis for multi-instance deployments.
  redis: {
    url: process.env.REDIS_URL || '',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS) || 15 * 60,
    refreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL_SECONDS) || 30 * 24 * 60 * 60,
    issuer: process.env.JWT_ISSUER || 'flower-market-api',
    audience: process.env.JWT_AUDIENCE || 'flower-market-app',
  },

  otp: {
    provider: process.env.OTP_PROVIDER || 'console', // phone slot: console | memory | msg91 | twilio
    /**
     * Email slot. Separate on purpose: MSG91 and Twilio are phone-only, but
     * signup sends an EMAIL OTP — so a single provider knob forced a choice
     * between "no email signup" and "no SMS login", and production boots on
     * msg91 passed the guard and then threw on every signup. Defaults to the
     * phone provider only when that provider can actually serve email.
     */
    emailProvider: process.env.OTP_EMAIL_PROVIDER || (process.env.OTP_PROVIDER === 'smtp' || process.env.OTP_PROVIDER === 'console' || process.env.OTP_PROVIDER === 'memory' ? (process.env.OTP_PROVIDER || 'console') : 'console'),
    /** Channels this deployment must be able to serve. Both are reachable in code. */
    requiredChannels: (process.env.OTP_REQUIRED_CHANNELS || 'phone,email').split(',').map((c) => c.trim()).filter(Boolean),
    length: Number(process.env.OTP_LENGTH) || 6,
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS) || 300,
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
    resendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60,
    msg91AuthKey: process.env.MSG91_AUTH_KEY || '',
    msg91TemplateId: process.env.MSG91_TEMPLATE_ID || '',
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: process.env.TWILIO_FROM || '',
  },

  tenant: {
    defaultTenantId: process.env.DEFAULT_TENANT_ID || '',
    tenantHeader: process.env.TENANT_HEADER || 'x-tenant-id',
  },

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:8081')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // ---- Wave 2: dual-write rupee totals as integer paise on API views ----
  // Off (`MONEY_DUAL_WRITE_PAISE=false`) restores the pre-Wave-2 payload
  // shape. On (default) adds `*Paise` siblings next to existing rupee fields
  // — never a second arithmetic path, never a stored-column rewrite.
  money: {
    dualWritePaise: process.env.MONEY_DUAL_WRITE_PAISE !== 'false',
  },

  // ---- Razorpay (real gateway) + mock provider behaviour ----
  payments: {
    // Explicit provider. Default: razorpay when keys exist, else the
    // deterministic mock. Production boot refuses mock (see assertProductionProviders).
    provider: process.env.PAYMENT_PROVIDER || (process.env.RAZORPAY_KEY_ID ? 'razorpay' : 'mock'),
    // Mock provider webhook secret — the mock gateway signs exactly like
    // Razorpay (HMAC-SHA256 of the raw body) so the verification path is
    // exercised identically in dev/test. Change via env in real deployments.
    mockWebhookSecret: process.env.MOCK_PAYMENT_WEBHOOK_SECRET || 'mock-webhook-secret-dev',
    // Set true to make the MOCK provider behave like Razorpay (async capture):
    // checkout returns a pending payment, order sits in PAYMENT_PENDING until
    // a signed webhook confirms. Lets the full async flow be exercised live
    // without real keys.
    mockPending: process.env.MOCK_PAYMENT_PENDING === 'true',
    // Reconciliation cadence for the worker's payment-reconcile job
    reconcileEveryMs: Number(process.env.PAYMENT_RECONCILE_EVERY_MS) || 5 * 60_000,
    // payments pending longer than this are resolved against the gateway
    pendingStaleMinutes: Number(process.env.PAYMENT_PENDING_STALE_MINUTES) || 15,
  },

  // ---- Cash on delivery ----
  cod: {
    /**
     * Is cash offered at all? A marketplace switches cash off for a monsoon, a
     * fraud spike, or a city where riders are being robbed — an env flip, not a
     * deploy. The storefront bootstrap publishes this so the radio button
     * disappears instead of the checkout failing later.
     */
    enabled: process.env.COD_ENABLED !== 'false',
    /**
     * Risk cap in PAISE (default ₹5,000). Cash is an unsecured credit line to a
     * stranger; above the cap the order must be prepaid. Enforced in
     * payment.service.charge BEFORE anything is created, so an over-cap attempt
     * is a clean 422 and never a half-built order. 0 disables the cap.
     */
    maxAmountPaise: Number(process.env.COD_MAX_AMOUNT_PAISE) || 500000,
    /**
     * Flat handling fee in PAISE (default ₹0). Carrying cash costs the platform
     * real money — a rider with notes in a bag, a remittance run, theft risk —
     * and most marketplaces pass some of it back. Defaults to 0 so enabling COD
     * never silently changes a price.
     */
    feePaise: Number(process.env.COD_FEE_PAISE) || 0,
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  limits: {
    jsonBody: process.env.JSON_BODY_LIMIT || '1mb',
    maxAddressesPerUser: Number(process.env.MAX_ADDRESSES_PER_USER) || 10,
  },

  // ---- Wallet top-up (gateway charge, then credit) ----
  wallet: {
    topupMin: Number(process.env.WALLET_TOPUP_MIN_AMOUNT) || 10,
    topupMax: Number(process.env.WALLET_TOPUP_MAX_AMOUNT) || 5000,
  },

  // ---- Phase 4b: notifications (provider-agnostic; console/mock default) ----
  notifications: {
    /**
     * The default adapter for every channel. Realistic deployments want
     * DIFFERENT vendors per channel (FCM for push, SMTP for mail, MSG91 for
     * SMS), so each channel can override it below — a single knob would force
     * one vendor to be good at all three, which none are.
     */
    provider: process.env.NOTIFICATION_PROVIDER || 'console', // console | mock | fcm | smtp | msg91 | twilio
    pushProvider: process.env.NOTIFICATION_PUSH_PROVIDER || process.env.NOTIFICATION_PROVIDER || 'console',
    emailProvider: process.env.NOTIFICATION_EMAIL_PROVIDER || process.env.NOTIFICATION_PROVIDER || 'console',
    smsProvider: process.env.NOTIFICATION_SMS_PROVIDER || process.env.NOTIFICATION_PROVIDER || 'console',
    /** From: address for transactional mail ("Flower Market <no-reply@x.in>"). */
    fromEmail: process.env.NOTIFICATION_FROM_EMAIL || '',
    maxDevicesPerUser: Number(process.env.MAX_DEVICES_PER_USER) || 10,
    workerBatch: Number(process.env.NOTIFICATION_WORKER_BATCH) || 50,
  },

  // ---- SMTP (transactional mail: OTPs, order notifications) ----
  // Implemented in utils/smtpClient.js with no mail dependency: the protocol
  // and MIME building are pure and unit-tested, the socket layer is thin.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    // true = implicit TLS (the 465 convention); false = STARTTLS on 587
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.NOTIFICATION_FROM_EMAIL || '',
    timeoutMs: Number(process.env.SMTP_TIMEOUT_MS) || 15000,
  },

  // ---- FCM HTTP v1 (push) ----
  // The legacy server-key API was shut down in June 2024, so a service account
  // is the only path. Supply the JSON file's contents, or its path.
  fcm: {
    projectId: process.env.FCM_PROJECT_ID || '',
    clientEmail: process.env.FCM_CLIENT_EMAIL || '',
    privateKey: (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    serviceAccountPath: process.env.FCM_SERVICE_ACCOUNT_PATH || '',
  },

  // ---- Phase 4b: scheduled exports ----
  exports: {
    nightlyDays: Number(process.env.EXPORT_NIGHTLY_DAYS) || 30,
    defaultScheduledAtHour: Number(process.env.EXPORT_NIGHTLY_HOUR) || 2, // 2 AM cron
  },

  // ---- Worker runtime (src/worker.js): outbox consumer + scheduled jobs ----
  // A separate process from the API. Consumes the catalog outbox with leased,
  // atomic claims (crash-safe, multi-worker safe) and runs the built-in
  // scheduled jobs (per-tenant nightly + marketplace nightly).
  worker: {
    enabled: process.env.WORKER_ENABLED !== 'false',
    pollMs: Number(process.env.WORKER_POLL_MS) || 5000, // outbox tick cadence
    batchSize: Number(process.env.WORKER_BATCH_SIZE) || 20, // events per tick
    leaseMs: Number(process.env.WORKER_LEASE_MS) || 60_000, // crash-recovery window
    maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS) || 5, // then dead-letter
    nightlyHour: Number(process.env.WORKER_NIGHTLY_HOUR) || 2, // local hour of day
  },

  // ---- Observability: /healthz, /readyz, /metrics (Prometheus) ----
  observability: {
    heartbeatMs: Number(process.env.OBS_HEARTBEAT_MS) || 10_000, // api+worker beat cadence
    // worker beats every WORKER_POLL_MS (5s default); 30s = 6 missed ticks ⇒ down
    workerAliveAfterSec: Number(process.env.OBS_WORKER_ALIVE_AFTER_SEC) || 30,
  },

  // ---- Phase 5: multi-tenant marketplace ----
  marketplace: {
    enabled: process.env.MARKETPLACE_ENABLED !== 'false', // platform-level switch
    billingProvider: process.env.BILLING_PROVIDER || 'console', // console | mock | razorpay
    defaultCommissionBps: Number(process.env.MARKETPLACE_DEFAULT_COMMISSION_BPS) || 100, // 1%
    defaultTrialDays: Number(process.env.MARKETPLACE_TRIAL_DAYS) || 14,
    invoiceGraceDays: Number(process.env.MARKETPLACE_INVOICE_GRACE_DAYS) || 7,
    // GST the platform charges on its own invoices (fee + commission + adjustment).
    // Explicit 0 disables the GST line (inter-state/exempt handling lands later).
    invoiceGstBps: Number.isFinite(Number(process.env.MARKETPLACE_INVOICE_GST_BPS))
      ? Number(process.env.MARKETPLACE_INVOICE_GST_BPS)
      : 1800,
    // Phase 6.4: these are now DNS labels too, so the list must also cover
    // infrastructure hostnames — a store called "mail" would hijack MX-adjacent
    // traffic and a store called "status" would shadow the status page.
    reservedSlugs: (process.env.MARKETPLACE_RESERVED_SLUGS
      || 'admin,api,www,app,platform,marketplace,flower-market,market,mail,smtp,imap,ftp,cdn,static,assets,media,img,images,status,help,support,docs,blog,pay,payments,checkout,billing,account,accounts,auth,login,dashboard,console,internal,staging,dev,test,demo,ns1,ns2,mx,vpn,git')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    nightlyDays: Number(process.env.MARKETPLACE_NIGHTLY_DAYS) || 30,
  },

  // ---- Self-service store onboarding ----
  // registerStore() used to create a Tenant, an auth config, an owner User and a
  // trial subscription — and nothing else. Checkout needs a hub, a serviceable
  // pincode linked to it, an open slot and a fee policy, so a new store could not
  // sell anything and nobody told the operator why. See utils/onboardingReadiness.js.
  //
  // Pincodes are deliberately NOT seeded: a merchant's delivery area is a business
  // fact nobody can guess, and a wrong guess puts a store in front of customers it
  // cannot serve. Only the safely-defaultable skeleton is created here.
  onboarding: {
    seedHub: process.env.ONBOARDING_SEED_HUB !== 'false',
    seedFeePolicy: process.env.ONBOARDING_SEED_FEE_POLICY !== 'false',
    hubName: process.env.ONBOARDING_HUB_NAME || 'Main hub',
    hubCode: process.env.ONBOARDING_HUB_CODE || 'HUB-01',
    hubSlotCapacity: Number(process.env.ONBOARDING_HUB_CAPACITY) || 25,
    // A seeded fee policy starts at ZERO, not at a number nobody chose. Free
    // delivery until the merchant sets a real fee is the honest default: the
    // alternative silently charges their customers on day one.
    defaultBaseFee: Number(process.env.ONBOARDING_DEFAULT_BASE_FEE) || 0,
    // 0/null = no free-delivery threshold (there is nothing to cross at ₹0 base).
    defaultFreeThreshold: Number(process.env.ONBOARDING_DEFAULT_FREE_THRESHOLD) || null,
    defaultExpressSurge: Number(process.env.ONBOARDING_DEFAULT_EXPRESS_SURGE) || 1,
    // Slots are generated this far ahead at registration, and readiness checks
    // that open slots exist across the same horizon.
    slotDaysAhead: Number(process.env.ONBOARDING_SLOT_DAYS_AHEAD) || 3,
    // Refuse to flip isPublished while the store cannot take an order. Turn off
    // only as an incident escape hatch — `ready` still reports the truth either way.
    requireReadyToPublish: process.env.ONBOARDING_REQUIRE_READY_TO_PUBLISH !== 'false',
    // Last resort when a tenant has NO active DeliveryFeePolicy at all. This was
    // a hardcoded `return 49` in the very file whose header said "Replaces the
    // hardcoded deliveryFee = 49" — a number no merchant chose, charged to real
    // customers, surfaced on no admin page. It is configured now, defaults to
    // zero, and every use is counted (fm_pricing_fallback_total{kind=...}).
    fallbackDeliveryFee: Number(process.env.ONBOARDING_FALLBACK_DELIVERY_FEE) || 0,
  },

  // ---- Media uploads (images & videos) ----
  storage: {
    provider: process.env.STORAGE_PROVIDER || 'local', // local | s3
    localDir: process.env.LOCAL_STORAGE_DIR || path.join(__dirname, '..', '..', 'storage', 'local'),
    localPublicPath: '/media/local',
    presignExpirySeconds: Number(process.env.MEDIA_PRESIGN_EXPIRY_SECONDS) || 15 * 60,
    s3: {
      bucket: process.env.S3_BUCKET || '',
      region: process.env.S3_REGION || 'ap-south-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || '', // defaults to bucket URL
    },
    limits: {
      maxImageBytes: Number(process.env.MEDIA_MAX_IMAGE_BYTES) || 10 * 1024 * 1024, // 10 MB
      maxVideoBytes: Number(process.env.MEDIA_MAX_VIDEO_BYTES) || 250 * 1024 * 1024, // 250 MB
      // Phase 6.0: per-tenant storage ceiling (0 = unlimited). Checked at
      // presign time against the sum of READY+PENDING assets for the tenant.
      tenantQuotaBytes: Number(process.env.MEDIA_TENANT_QUOTA_BYTES) || 5 * 1024 * 1024 * 1024, // 5 GB
      imageTypes: ['jpeg', 'jpg', 'png', 'webp', 'gif', 'avif'],
      videoTypes: ['mp4', 'webm', 'mov', 'quicktime'],
    },
  },

  // ---- Phase 6.2: GST / tax invoicing ----
  tax: {
    /**
     * Are catalogue prices tax-INCLUSIVE (Indian MRP convention)?
     * The engine supports both; this flag is what a future checkout migration
     * will switch on. The INVOICE layer reconstructs from persisted order
     * values either way, so flipping this does not rewrite history.
     */
    pricesInclusive: process.env.TAX_PRICES_INCLUSIVE !== 'false',
    /** Fallback supplier state code when no TaxRegistration exists (37 = AP). */
    defaultStateCode: process.env.TAX_DEFAULT_STATE_CODE || '37',
    invoicePrefix: process.env.TAX_INVOICE_PREFIX || 'FM',
    creditNotePrefix: process.env.TAX_CREDIT_NOTE_PREFIX || 'CN',
    numberWidth: Number(process.env.TAX_NUMBER_WIDTH) || 6,
    /** Financial year start month (India = April). */
    fyStartMonth: Number(process.env.TAX_FY_START_MONTH) || 4,
    einvoice: {
      provider: process.env.EINVOICE_PROVIDER || 'console', // console | mock | gsp
      baseUrl: process.env.EINVOICE_GSP_BASE_URL || null,
      apiKey: process.env.EINVOICE_GSP_API_KEY || null,
      apiSecret: process.env.EINVOICE_GSP_API_SECRET || null,
    },
  },

  // ---- Phase 6.5: search ranking ----
  search: {
    provider: process.env.SEARCH_PROVIDER || 'mongo', // mongo | atlas | opensearch
    defaultProfile: process.env.SEARCH_DEFAULT_PROFILE || 'default',
    /** % of queries written to the query log (sampling keeps writes cheap). */
    logSamplePct: Number(process.env.SEARCH_LOG_SAMPLE_PCT ?? 100),
    /** Serve /catalog from the ranked index. Off = the legacy regex path. */
    rankedCatalog: process.env.SEARCH_RANKED_CATALOG !== 'false',
  },

  // ---- Phase 6.4: subdomain & custom-domain routing ----
  domains: {
    /** Master switch. Off = pure header-based resolution (pre-6.4 behaviour). */
    enabled: process.env.DOMAIN_ROUTING_ENABLED !== 'false',
    rootDomain: process.env.PLATFORM_ROOT_DOMAIN || 'flowermarket.in',
    /**
     * Trust `x-forwarded-host`. Only enable behind a proxy you control — an
     * untrusted forwarded host is a tenant-spoofing vector.
     */
    trustForwardedHost: process.env.TRUST_FORWARDED_HOST === 'true',
    /**
     * Allow `x-tenant-id` to override a Host that already resolved. This is a
     * DEVELOPMENT affordance (one localhost acting as any tenant); in
     * production the hostname must win.
     */
    allowHeaderOverride: process.env.ALLOW_TENANT_HEADER_OVERRIDE
      ? process.env.ALLOW_TENANT_HEADER_OVERRIDE === 'true'
      : env !== 'production',
    /**
     * Resolve `<slug>.localhost` to the tenant with that slug. LOCAL
     * DEVELOPMENT ONLY (default on outside production): one dev server acts
     * as every store via `http://<slug>.localhost:<port>` — own hostname,
     * own sessions, own carts — exactly like production subdomains.
     */
    allowLocalSubdomains: process.env.ALLOW_LOCAL_SUBDOMAINS
      ? process.env.ALLOW_LOCAL_SUBDOMAINS === 'true'
      : env !== 'production',
    cacheTtlMs: Number(process.env.DOMAIN_RESOLUTION_CACHE_TTL_MS) || 300000,
    /** IPs allowed to call the TLS `ask` hook (comma-separated; empty = any). */
    tlsHookAllowlist: (process.env.TLS_HOOK_IP_ALLOWLIST || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  },

  // ---- Phase 6.3: vendor payout disbursement ----
  payouts: {
    provider: process.env.PAYOUT_PROVIDER || 'console', // console | mock | razorpayx | cashfree
    webhookSecret: process.env.PAYOUT_WEBHOOK_SECRET || null,
    /** Minutes a batch may sit in PROCESSING before the reconciler chases it. */
    reconcileAfterMinutes: Number(process.env.PAYOUT_RECONCILE_AFTER_MINUTES) || 15,
    razorpayx: {
      keyId: process.env.RAZORPAYX_KEY_ID || null,
      keySecret: process.env.RAZORPAYX_KEY_SECRET || null,
      accountNumber: process.env.RAZORPAYX_ACCOUNT_NUMBER || null,
      baseUrl: process.env.RAZORPAYX_BASE_URL || 'https://api.razorpay.com/v1',
    },
    cashfree: {
      clientId: process.env.CASHFREE_CLIENT_ID || null,
      clientSecret: process.env.CASHFREE_CLIENT_SECRET || null,
      baseUrl: process.env.CASHFREE_BASE_URL || 'https://payout-api.cashfree.com',
    },
  },

  // ---- Phase 6.1: financial ledger ----
  ledger: {
    /**
     * strict=true  → a failed ledger post fails the calling operation.
     * strict=false → the failure is logged and left to the backfill sweep
     *                (journals are idempotent, so re-posting is always safe).
     * Default: strict in production, lenient elsewhere so a dev DB without a
     * replica set never blocks checkout.
     */
    strict: process.env.LEDGER_STRICT
      ? process.env.LEDGER_STRICT === 'true'
      : env === 'production',
    /** Force-disable transactions (useful against a standalone mongod). */
    disableTransactions: process.env.LEDGER_DISABLE_TRANSACTIONS === 'true',
    baseCurrency: process.env.LEDGER_BASE_CURRENCY || 'INR',
  },
};

export default config;
