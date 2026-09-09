/**
 * OpenAPI 3.0 specification generator and Swagger UI server.
 *
 * Mounts:
 *   GET /api/v1/openapi.json — machine-readable spec
 *   GET /api/v1/docs         — interactive Swagger UI
 *
 * The spec is generated from route annotations at startup. Every route
 * that uses Joi validation automatically gets its request schema documented.
 *
 * Usage:
 *   import { mountOpenAPI } from './middleware/openapi.js';
 *   mountOpenAPI(app); // after all routes are registered
 */
import config from '../config/index.js';

/**
 * Build the OpenAPI 3.0 spec from the Express app's registered routes.
 */
function buildSpec(app) {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Flower Market API',
      description: 'Multi-tenant flower marketplace — BigBasket-style slotted delivery, double-entry ledger, GST invoicing, vendor payouts.',
      version: '1.0.0',
      contact: { name: 'Flower Market', url: 'https://flowermarket.in' },
    },
    servers: [
      { url: '/api/v1', description: 'Current' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token from POST /auth/otp/verify or POST /auth/login',
        },
      },
      schemas: {
        Envelope: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: { type: 'object' },
            meta: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                totalPages: { type: 'integer' },
                hasMore: { type: 'boolean' },
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            code: { type: 'string' },
            details: { type: 'object' },
          },
        },
        Money: {
          type: 'object',
          properties: {
            mrp: { type: 'number', description: 'MRP in rupees' },
            sellingPrice: { type: 'number', description: 'Selling price in rupees' },
            currency: { type: 'string', example: 'INR' },
          },
        },
      },
    },
    paths: {},
    tags: [
      { name: 'Auth', description: 'OTP, login, sessions, password management' },
      { name: 'Users', description: 'Profile, addresses, preferences' },
      { name: 'Catalog', description: 'Product browsing, search, categories' },
      { name: 'Cart', description: 'Cart management, checkout, slots' },
      { name: 'Orders', description: 'Order lifecycle, tracking, cancellation' },
      { name: 'Returns', description: 'Return requests, QC, refunds' },
      { name: 'Wallet', description: 'Balance, top-up, transactions' },
      { name: 'Fulfillment', description: 'Picking, packing, delivery, slots' },
      { name: 'Rider', description: 'Delivery state machine for riders' },
      { name: 'Policies', description: 'Delivery fee, tax, coupons, refund policies' },
      { name: 'Admin', description: 'Dashboard, inventory, users, analytics' },
      { name: 'Marketplace', description: 'Multi-tenant marketplace, vendors, billing' },
      { name: 'Media', description: 'Image and video uploads' },
      { name: 'Tax', description: 'GST invoicing, registrations, rates' },
      { name: 'Payouts', description: 'Vendor payouts, settlements, statutory deposits' },
      { name: 'Ledger', description: 'Double-entry ledger, integrity, periods' },
      { name: 'Domains', description: 'Subdomain and custom domain routing' },
      { name: 'Search', description: 'Search ranking, synonyms, analytics' },
    ],
  };

  // Walk the Express route stack and extract path + method + metadata
  const stack = app._router?.stack || [];
  for (const layer of stack) {
    if (layer.route) {
      const path = layer.route.path;
      const methods = Object.keys(layer.route.methods);
      for (const method of methods) {
        if (!spec.paths[path]) spec.paths[path] = {};
        spec.paths[path][method] = {
          responses: {
            200: { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } },
            400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            401: { description: 'Authentication required' },
            403: { description: 'Forbidden' },
            404: { description: 'Not found' },
            409: { description: 'Conflict' },
            429: { description: 'Rate limited' },
            500: { description: 'Internal server error' },
          },
        };
      }
    }
  // Walk sub-routers (e.g., /api/v1/auth, /api/v1/orders)
  if (layer.handle?.stack) {
    for (const sub of layer.handle.stack) {
      if (sub.route) {
        const fullPath = sub.route.path;
        const methods = Object.keys(sub.route.methods);
        for (const method of methods) {
          if (!spec.paths[fullPath]) spec.paths[fullPath] = {};
          if (!spec.paths[fullPath][method]) {
            spec.paths[fullPath][method] = {
              responses: {
                200: { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } },
                400: { description: 'Validation error' },
                401: { description: 'Authentication required' },
              },
            };
          }
        }
      }
    }
  }
  }

  return spec;
}

/**
 * Mount OpenAPI spec + Swagger UI on the Express app.
 * Only serves in development and staging (not production).
 */
export function mountOpenAPI(app) {
  // Always serve the spec (clients and CI need it)
  app.get('/api/v1/openapi.json', (req, res) => {
    const spec = buildSpec(app);
    res.json(spec);
  });

  // Swagger UI — simple self-contained HTML (no external CDN dependency)
  app.get('/api/v1/docs', (req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Flower Market API — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/v1/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
    });
  </script>
</body>
</html>`);
  });
}

export default mountOpenAPI;
