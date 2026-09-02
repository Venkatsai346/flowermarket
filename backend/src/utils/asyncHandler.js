/**
 * asyncHandler — wraps async route handlers so thrown/rejected errors are
 * forwarded to the Express error middleware (no try/catch noise in controllers).
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
