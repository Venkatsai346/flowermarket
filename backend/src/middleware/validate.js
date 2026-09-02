import { badRequest } from '../utils/ApiError.js';

/**
 * validate(schema, source='body') — Joi request validation middleware.
 * On failure returns a 400 with structured `details` (field -> message).
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const details = {};
      for (const d of error.details) {
        const key = d.path.join('.') || 'value';
        details[key] = d.message.replace(/"/g, "'");
      }
      return next(badRequest('Validation failed', 'VALIDATION_ERROR', details));
    }

    req[source] = value; // replace with validated/coerced value
    next();
  };
}
