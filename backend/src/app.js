import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import config from './config/index.js';
import apiRouter from './routes/index.js';
import PaymentController from './controllers/payment.controller.js';
import PayoutController from './controllers/payout.controller.js';
import notificationService from './services/notification.service.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

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

  const app = express();

  app.disable('x-powered-by');

  // ---- security headers ----
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

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

  // ---- perf & logging ----
  app.use(compression());
  app.use(morgan(config.isDev ? 'dev' : 'combined'));

  // ---- routes ----
  app.use('/api/v1', apiRouter);

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

  // ---- 404 + error handling (must be last) ----
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
