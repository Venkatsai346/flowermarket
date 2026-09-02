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
      origin(origin, cb) {
        if (!origin || config.corsOrigins.includes(origin) || config.isDev) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
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
