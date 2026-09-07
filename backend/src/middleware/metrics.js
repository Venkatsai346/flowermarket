/**
 * HTTP metrics middleware — request counts + duration histogram.
 *
 * Route labels use the MATCHED ROUTE PATTERN (e.g. `/api/v1/orders/:id`) via
 * `req.route.path` + `req.baseUrl` — a bounded set, so label cardinality
 * never explodes with ids. Unmatched paths collapse to their first segment.
 * The ops endpoints themselves (/healthz, /readyz, /metrics) are excluded to
 * keep scrape traffic out of the request metrics.
 *
 * A metrics failure must never break a request — everything is try/caught.
 */

import { httpRequests, httpDuration } from '../observability/registry.js';

const SKIP = /^\/(healthz|readyz|metrics)(\/|$)/;

export function metricsMiddleware() {
  return (req, res, next) => {
    if (SKIP.test(req.path)) return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        let route;
        if (req.route && req.route.path) {
          route = `${req.baseUrl}${req.route.path}`;
        } else {
          route = `:unmatched/${(req.path.split('/').filter(Boolean)[0] || 'root')}`;
        }
        const status = String(res.statusCode);
        httpRequests.inc({ method: req.method, route, status });
        httpDuration.observe({ method: req.method, route }, seconds);
      } catch {
        // metrics are never in the request path
      }
    });
    next();
  };
}
