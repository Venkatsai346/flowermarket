import mongoose from 'mongoose';
import config from '../config/index.js';
import { AppError } from '../utils/ApiError.js';

/**
 * Centralized error handler — the single place where every error becomes an
 * HTTP response. Controllers/services throw; this formats.
 */
export function notFoundHandler(req, res, next) {
  const err = new AppError(`Route not found: ${req.method} ${req.originalUrl}`, {
    status: 404,
    code: 'ROUTE_NOT_FOUND',
  });
  next(err);
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Something went wrong';
  let details = err.details || null;

  // ---- normalize known error families ----
  if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = Object.fromEntries(
      Object.entries(err.errors).map(([k, e]) => [k, e.message])
    );
  } else if (err.name === 'MongoServerError' && err.code === 11000) {
    status = 409;
    code = 'DUPLICATE_KEY';
    message = 'Duplicate value for a unique field';
    details = err.keyValue || null;
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'INVALID_ID';
    message = `Invalid value for "${err.path}"`;
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request payload too large';
  }

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
  }

  const body = { success: false, message, code, ...(details ? { details } : {}) };
  if (config.isDev && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
}
