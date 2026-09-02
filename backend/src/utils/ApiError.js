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
export const tooMany = (message = 'Too many requests', code = 'RATE_LIMITED') =>
  new AppError(message, { status: 429, code });
