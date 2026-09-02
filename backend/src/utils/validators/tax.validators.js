import Joi from 'joi';
import {
  TAX_DOC_TYPE, TAX_DOC_STATUS, TAX_NATURE_OF_SUPPLY,
  TAX_REGISTRATION_TYPE, STATUTORY_RATE_KIND, CREDIT_NOTE_REASON,
} from '../../constants/enums.js';

const objectId = Joi.string().hex().length(24);

export const taxDocListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  docType: Joi.string().valid(...Object.values(TAX_DOC_TYPE)),
  status: Joi.string().valid(...Object.values(TAX_DOC_STATUS)),
  vendorId: objectId,
  orderId: objectId,
  fyLabel: Joi.string().max(8),
  from: Joi.date().iso(),
  to: Joi.date().iso(),
});

export const taxDocIdParamSchema = Joi.object({ id: objectId.required() });

export const issueInvoiceSchema = Joi.object({
  orderId: objectId.required(),
  force: Joi.boolean().default(false),
});

export const cancelDocSchema = Joi.object({
  reason: Joi.string().min(3).max(300).required(),
});

export const creditNoteSchema = Joi.object({
  refundTransactionId: objectId,
  invoiceId: objectId,
  amount: Joi.number().positive(),
  reason: Joi.string().valid(...Object.values(CREDIT_NOTE_REASON)).default('return'),
}).or('refundTransactionId', 'invoiceId');

export const registrationSchema = Joi.object({
  legalName: Joi.string().min(2).max(160).required(),
  tradeName: Joi.string().max(160).allow(null, ''),
  gstin: Joi.string().length(15).uppercase().allow(null, ''),
  pan: Joi.string().length(10).uppercase().allow(null, ''),
  stateCode: Joi.string().length(2),
  address: Joi.object({
    line1: Joi.string().max(200).allow(null, ''),
    line2: Joi.string().max(200).allow(null, ''),
    city: Joi.string().max(80).allow(null, ''),
    state: Joi.string().max(80).allow(null, ''),
    pincode: Joi.string().max(10).allow(null, ''),
  }),
  contact: Joi.object({
    email: Joi.string().email().allow(null, ''),
    phone: Joi.string().max(20).allow(null, ''),
  }),
  registrationType: Joi.string().valid(...Object.values(TAX_REGISTRATION_TYPE)),
  turnoverBand: Joi.string().valid('lt_5cr', 'gte_5cr'),
  einvoiceEnabled: Joi.boolean(),
  invoiceFooter: Joi.string().max(1000).allow(null, ''),
  invoiceTerms: Joi.string().max(2000).allow(null, ''),
  signatureUrl: Joi.string().uri().allow(null, ''),
  status: Joi.string().valid('active', 'inactive'),
});

export const taxPolicySchema = Joi.object({
  categoryId: objectId.required(),
  rateBps: Joi.number().integer().min(0).max(10000),
  gstSlabPct: Joi.number().min(0).max(100),
  cessBps: Joi.number().integer().min(0),
  natureOfSupply: Joi.string().valid(...Object.values(TAX_NATURE_OF_SUPPLY)),
  hsnCode: Joi.string().max(16).allow(null, ''),
  effectiveFrom: Joi.date().iso(),
}).or('rateBps', 'gstSlabPct');

export const statutoryRateSchema = Joi.object({
  kind: Joi.string().valid(...Object.values(STATUTORY_RATE_KIND)).required(),
  rateBps: Joi.number().integer().min(0).max(10000).required(),
  appliesTo: Joi.string().valid('net_taxable', 'gross_sales'),
  effectiveFrom: Joi.date().iso(),
  notificationRef: Joi.string().max(200).allow(null, ''),
  note: Joi.string().max(500).allow(null, ''),
});

export const seriesAuditQuerySchema = Joi.object({
  ownerType: Joi.string().valid('platform', 'tenant', 'vendor').required(),
  ownerId: objectId.allow(null, ''),
  docType: Joi.string().valid(...Object.values(TAX_DOC_TYPE)).required(),
  fyLabel: Joi.string().max(8).required(),
});
