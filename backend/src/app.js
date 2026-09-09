import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import config from './config/index.js';
import apiRouter from './routes/index.js';
import opsRoutes from './routes/ops.routes.js';
import healthRoutes from './routes/health.routes.js';
import PaymentController from './controllers/payment.controller.js';
import PayoutController from './controllers/payout.controller.js';
import SitemapController from './controllers/sitemap.controller.js';
import searchIndexer from './services/searchIndexer.service.js';
import notificationService from './services/notification.service.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { metricsMiddleware } from './middleware/metrics.js';
import traceId from './middleware/traceId.js';
import { structuredLogger } from './middleware/structuredLogger.js';
import { timeoutMiddleware } from './middleware/timeout.js';
import { mountOpenAPI } from './middleware/openapi.js';

/**
 * App factory — keeps server.js free of middleware wiring and lets tests
 * build an app without binding a port.
 */
/**
 * Verified custom domains, kept in memory for the CORS check. Refreshed
 * lazily (a CORS decision must be synchronous, so it cannot await a query).
 * A newly verified domain becomes an allowed origin within one refresh window.
 */
const liveCustomHosts = new Set();
let lastHostRefresh = 0;

async function refreshLiveHosts() {
  if (Date.now() - lastHostRefresh < 60000) return;
  lastHostRefresh = Date.now();
  try {
    const { default: tenantDomainService } = await import('./services/tenantDomain.service.js');
    const hosts = await tenantDomainService.liveHostnames();
    liveCustomHosts.clear();
    for (const h of hosts) liveCustomHosts.add(h);
  } catch {
    // a DB hiccup must not break CORS for the configured allowlist
  }
}

export function createApp() {
  // Phase 4b: register the event→notification consumer on the catalog outbox
  // (Set-based + idempotent — safe even if createApp is called repeatedly).
  notificationService.initConsumer();
  // Phase 6.5: the search indexer rides the SAME catalog outbox — no new
  // event plumbing, and index freshness inherits its at-least-once delivery.
  searchIndexer.initConsumer();

  const app = express();

  app.disable('x-powered-by');
  // Rate-limit keys use req.ip. Behind a reverse proxy that is the
  // forwarded address only when we trust the hop. Production (and any
  // deploy that already trusts x-forwarded-host) must set this or every
  // customer shares one bucket.
  if (config.isProd || config.domains.trustForwardedHost) {
    app.set('trust proxy', 1);
  }

  // ---- end-to-end correlation (Phase 10) — first, so every request, the
  //      access log and every aggregate it creates share one traceId ----
  app.use(traceId);

  // ---- security headers ----
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Phase 7.0.8: Content-Security-Policy (report-only in dev, enforced in prod)
    contentSecurityPolicy: config.isProd ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https://api.razorpay.com", "https://*.razorpay.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        frameSrc: ["'self'", "https://api.razorpay.com", "https://*.razorpay.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    } : false, // no CSP in dev (breaks Vite HMR)
  }));

  // ---- request metrics (first thing, so every request — including 4xx/5xx —
  //      is timed; the ops endpoints exclude themselves) ----
  app.use(metricsMiddleware());

  // ---- ops: /healthz, /readyz, /metrics — mounted before morgan so scrape
  //      traffic never pollutes the access log, and before auth/tenant so a
  //      monitor needs no tenant header or token ----
  app.use(opsRoutes);

  // ---- CORS (React Native app / admin web) ----
  app.use(
    cors({
      /**
       * Phase 6.4: origin policy is now host-aware.
       *
       * Allowed:
       *   - no Origin (server-to-server, curl, webhooks)
       *   - the configured CORS_ORIGINS allowlist
       *   - any storefront on the platform root domain: https://{slug}.{root}
       *   - a verified custom domain (checked against the live set, cached)
       *   - in development only: localhost and the sandbox preview host
       *
       * The pre-6.4 rule allowed EVERY origin whenever `isDev` was true — and
       * NODE_ENV defaults to 'development', so a deploy with an unset NODE_ENV
       * shipped an open CORS policy. Development now allows a specific,
       * enumerated set instead of everything.
       */
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (config.corsOrigins.includes(origin)) return cb(null, true);

        let host = null;
        try { host = new URL(origin).hostname.toLowerCase(); } catch { return cb(new Error('Not allowed by CORS')); }

        const root = config.domains.rootDomain?.toLowerCase();
        if (root && (host === root || host.endsWith(`.${root}`))) return cb(null, true);

        if (config.isDev) {
          // localhost, 127.0.0.1, *.localhost and the e2b sandbox preview host
          if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1') return cb(null, true);
          if (/\.e2b\.app$/.test(host)) return cb(null, true);
        }

        if (liveCustomHosts.has(host)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );

  // ---- body parsing ----
  // Webhooks MUST be raw: signature verification needs the exact bytes
  // (Razorpay HMAC is computed over the raw body). Mounted before express.json
  // so the body is never re-parsed.
  app.post('/api/v1/payments/webhook/razorpay', express.raw({ type: '*/*' }), PaymentController.webhookRazorpay);
  app.post('/api/v1/payments/webhook/mock', express.raw({ type: '*/*' }), PaymentController.webhookMock);

  // Phase 6.3: payout provider webhook. Same rule as the payment webhooks —
  // the HMAC is over the exact bytes, so this MUST be mounted before
  // express.json() consumes the stream.
  app.post('/api/v1/payouts/webhook', express.raw({ type: '*/*' }), PayoutController.webhook);

  // keep the verified-custom-domain set warm (throttled internally)
  app.use((req, _res, nextMw) => { refreshLiveHosts(); nextMw(); });

  app.use(express.json({ limit: config.limits.jsonBody }));
  app.use(express.urlencoded({ extended: true, limit: config.limits.jsonBody }));

  // ---- perf & logging (Phase 7.0.6: structured JSON in production) ----
  app.use(compression());
  app.use(structuredLogger());

  // ---- request timeout (Phase 7.0.16: prevent hung requests) ----
  app.use(timeoutMiddleware(30_000));

  // ---- health probes (Phase 7.0: /health, /health/ready, /health/deep) ----
  app.use('/health', healthRoutes);

  // ---- routes ----
  app.use('/api/v1', apiRouter);

  // ---- OpenAPI spec + Swagger UI (Phase 7.0.17) ----
  mountOpenAPI(app);

  // ---- local storage: serve uploaded objects (public storefront images) ----
  if (config.storage.provider === 'local') {
    fs.mkdirSync(config.storage.localDir, { recursive: true });
    app.use(config.storage.localPublicPath, express.static(config.storage.localDir));
  }

  // dev-only landing page (helps when browsing the API root in a browser)
  if (config.isDev) {
    app.get('/', (req, res) => {
      res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${config.appName}</title>
<style>body{font-family:ui-monospace,Menlo,monospace;max-width:860px;margin:40px auto;padding:0 20px;background:#0f1115;color:#e6e6e6;line-height:1.6}
h1{color:#f5b942}code{background:#1c2029;padding:2px 6px;border-radius:4px;color:#8fd08f}a{color:#7db8ff}.ok{color:#6ee76e}</style></head><body>
<h1>🌷 ${config.appName}</h1>
<p><span class="ok">● running</span> (${config.env})</p>
<ul>
<li><a href="/api/v1/health">GET /api/v1/health</a></li>
<li><a href="/api/v1/not-a-route">GET /api/v1/not-a-route</a> → structured 404</li>
</ul>
<p>Full API reference: <code>docs/API.md</code></p>
</body></html>`);
    });
  }

  // ---- sitemap (SEO: dynamic per-tenant sitemap.xml) ----
  app.get('/sitemap.xml', SitemapController.generate);

  // ---- 404 + error handling (must be last) ----
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
