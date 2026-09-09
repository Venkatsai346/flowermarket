/**
 * Request timeout middleware.
 *
 * Terminates requests that exceed the configured duration with 504 Gateway
 * Timeout. Prevents hung queries, slow external calls, or infinite loops
 * from holding connections open indefinitely.
 *
 * Long-running operations (exports, bulk imports) should opt out by setting
 * `req.skipTimeout = true` before the timeout fires.
 *
 * Usage:
 *   app.use(timeoutMiddleware(30_000)); // 30s default
 */
import config from '../config/index.js';

export function timeoutMiddleware(ms = 30_000) {
  return function timeout(req, res, next) {
    // Skip timeout for raw-body routes (webhooks, media uploads)
    if (req.skipTimeout) return next();

    const timer = setTimeout(() => {
      if (res.headersSent) return; // already responded — too late
      res.status(504).json({
        success: false,
        message: 'Request timed out',
        code: 'REQUEST_TIMEOUT',
        details: { timeoutMs: ms, path: req.path, method: req.method },
      });
      // Destroy the socket after sending the response to free the connection
      // (Express will not process further middleware for this request)
      req.destroy();
    }, ms);

    // Clear the timeout when the response finishes (success or error)
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}

export default timeoutMiddleware;
