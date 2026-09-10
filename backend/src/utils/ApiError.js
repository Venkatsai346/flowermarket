/**
 * AppError — operational error with status + optional error code.
 * Used across services/controllers and normalized by the error middleware.
 */
export class AppError extends Error {
  constructor(message, { status = 400, code = 'BAD_REQUEST', details = null, cause = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status; // HTTP status
    this.code = code; // machine-readable error code, e.g. 'OTP_EXPIRED'
    this.details = details; // optional structured payload (e.g. validation errors)
    this.isOperational = true;
    if (cause) this.cause = cause;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** 400-series factories keep controllers readable. */
export const badRequest = (message = 'Bad request', code = 'BAD_REQUEST', details) =>
  new AppError(message, { status: 400, code, details });
export const unauthorized = (message = 'Unauthorized', code = 'UNAUTHORIZED') =>
  new AppError(message, { status: 401, code });
export const forbidden = (message = 'Forbidden', code = 'FORBIDDEN') =>
  new AppError(message, { status: 403, code });
export const notFound = (message = 'Not found', code = 'NOT_FOUND') =>
  new AppError(message, { status: 404, code });
export const conflict = (message = 'Conflict', code = 'CONFLICT', details) =>
  new AppError(message, { status: 409, code, details });
export const tooMany = (message = 'Too many requests', code = 'RATE_LIMITED', details) =>
  new AppError(message, { status: 429, code, details });
/** 402 — billing gates (past-due subscription, plan limit exceeded). */
export const paymentRequired = (message = 'Payment required', code = 'PAYMENT_REQUIRED', details) =>
  new AppError(message, { status: 402, code, details });
/** 500 — server-side invariant broken (misconfig, schema mismatch). Never a client bug. */
export const internal = (message = 'Internal error', code = 'INTERNAL_ERROR', details) =>
  new AppError(message, { status: 500, code, details });
