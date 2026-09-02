import Joi from 'joi';
import { MEDIA_PURPOSE } from '../../constants/enums.js';

const objectId = Joi.string().pattern(/^[0-9a-fA-F]{24}$/).messages({ 'string.pattern.base': 'Invalid id' });

export const presignSchema = Joi.object({
  filename: Joi.string().max(255).required(),
  contentType: Joi.string().max(120).required(),
  size: Joi.number().positive().required(),
  purpose: Joi.string().valid(...Object.values(MEDIA_PURPOSE)).required(),
});

export const mediaListQuerySchema = Joi.object({
  purpose: Joi.string().valid(...Object.values(MEDIA_PURPOSE)).optional(),
  type: Joi.string().valid('image', 'video').optional(),
  status: Joi.string().valid('pending', 'ready', 'failed', 'deleted').optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

export const mediaIdParamSchema = Joi.object({
  id: objectId.required(),
});
