/**
 * Structured JSON logger — replaces Morgan text logs in production.
 *
 * Every log line is a single JSON object, parseable by any log aggregator
 * (ELK, Loki, CloudWatch, Datadog). Fields:
 *
 *   { ts, level, msg, method, path, status, durationMs, traceId,
 *     tenantId, userId, ip, userAgent, contentLength }
 *
 * In development, falls back to Morgan's colorized dev format for readability.
 *
 * Usage:
 *   import { structuredLogger } from './middleware/structuredLogger.js';
 *   app.use(structuredLogger());
 */

import morgan from 'morgan';
import config from '../config/index.js';

/**
 * Escape a string for safe embedding in a JSON value (no raw newlines/tabs
 * that would break a line-delimited JSON parser).
 */
function safe(str) {
  if (str == null) return '';
  return String(str).replace(/[\r\n\t]/g, ' ').slice(0, 500);
}

/**
 * Production structured logger — one JSON object per request.
 */
function jsonFormat(tokens, req, res) {
  const entry = {
    ts: new Date().toISOString(),
    level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    msg: 'request',
    method: safe(tokens.method(req, res)),
    path: safe(tokens.url(req, res)),
    status: Number(tokens.status(req, res)),
    durationMs: parseFloat(tokens['response-time'](req, res)) || 0,
    contentLength: Number(tokens.res(req, res, 'content-length')) || 0,
    traceId: req.traceId || null,
    tenantId: req.tenantId ? String(req.tenantId) : null,
    userId: req.auth?.userId ? String(req.auth.userId) : null,
    ip: req.ip || req.socket?.remoteAddress || null,
    userAgent: safe(req.headers['user-agent']),
  };
  return JSON.stringify(entry);
}

/**
 * Development format — colorized, human-readable (Morgan dev + trace).
 */
const devFormat = ':method :url :status - :response-time ms - :res[content-length] :trace';

/**
 * Create the appropriate logger middleware for the current environment.
 */
export function structuredLogger() {
  if (config.isProd) {
    return morgan(jsonFormat, {
      // Skip health/metrics probes so they don't pollute the log stream
      skip: (req) => req.path === '/healthz' || req.path === '/readyz' || req.path === '/metrics',
    });
  }

  // Development: Morgan dev format with trace ID appended
  morgan.token('trace', (req) => req.traceId || '-');
  return morgan(devFormat, {
    skip: (req) => req.path === '/healthz' || req.path === '/readyz' || req.path === '/metrics',
  });
}

export default structuredLogger;
