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

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS) || 15 * 60,
    refreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL_SECONDS) || 30 * 24 * 60 * 60,
    issuer: process.env.JWT_ISSUER || 'flower-market-api',
    audience: process.env.JWT_AUDIENCE || 'flower-market-app',
  },

  otp: {
    provider: process.env.OTP_PROVIDER || 'console', // console | memory | msg91 | twilio | ses
    length: Number(process.env.OTP_LENGTH) || 6,
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS) || 300,
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
    resendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60,
  },

  tenant: {
    defaultTenantId: process.env.DEFAULT_TENANT_ID || '',
    tenantHeader: process.env.TENANT_HEADER || 'x-tenant-id',
  },

  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:8081')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  limits: {
    jsonBody: process.env.JSON_BODY_LIMIT || '1mb',
    maxAddressesPerUser: Number(process.env.MAX_ADDRESSES_PER_USER) || 10,
  },

  // ---- Phase 4b: notifications (provider-agnostic; console/mock default) ----
  notifications: {
    provider: process.env.NOTIFICATION_PROVIDER || 'console', // console | mock | fcm | apns | smtp | twilio
    maxDevicesPerUser: Number(process.env.MAX_DEVICES_PER_USER) || 10,
    workerBatch: Number(process.env.NOTIFICATION_WORKER_BATCH) || 50,
  },

  // ---- Phase 4b: scheduled exports ----
  exports: {
    nightlyDays: Number(process.env.EXPORT_NIGHTLY_DAYS) || 30,
    defaultScheduledAtHour: Number(process.env.EXPORT_NIGHTLY_HOUR) || 2, // 2 AM cron
  },

  // ---- Phase 5: multi-tenant marketplace ----
  marketplace: {
    enabled: process.env.MARKETPLACE_ENABLED !== 'false', // platform-level switch
    billingProvider: process.env.BILLING_PROVIDER || 'console', // console | mock | razorpay
    defaultCommissionBps: Number(process.env.MARKETPLACE_DEFAULT_COMMISSION_BPS) || 100, // 1%
    defaultTrialDays: Number(process.env.MARKETPLACE_TRIAL_DAYS) || 14,
    invoiceGraceDays: Number(process.env.MARKETPLACE_INVOICE_GRACE_DAYS) || 7,
    // Phase 6.4: these are now DNS labels too, so the list must also cover
    // infrastructure hostnames — a store called "mail" would hijack MX-adjacent
    // traffic and a store called "status" would shadow the status page.
    reservedSlugs: (process.env.MARKETPLACE_RESERVED_SLUGS
      || 'admin,api,www,app,platform,marketplace,flower-market,market,mail,smtp,imap,ftp,cdn,static,assets,media,img,images,status,help,support,docs,blog,pay,payments,checkout,billing,account,accounts,auth,login,dashboard,console,internal,staging,dev,test,demo,ns1,ns2,mx,vpn,git')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    nightlyDays: Number(process.env.MARKETPLACE_NIGHTLY_DAYS) || 30,
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
