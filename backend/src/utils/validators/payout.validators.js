import Joi from 'joi';
import {
  PAYOUT_STATE, PAYOUT_HOLD_REASON, PAYOUT_ADJUSTMENT_REASON, PAYOUT_METHOD,
} from '../../constants/enums.js';

const objectId = Joi.string().hex().length(24);

export const payoutListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  state: Joi.string().valid(...Object.values(PAYOUT_STATE)),
  vendorId: objectId,
});

export const payoutIdParamSchema = Joi.object({ id: objectId.required() });

export const computeCycleSchema = Joi.object({
  from: Joi.date().iso().required(),
  to: Joi.date().iso().required(),
  vendorId: objectId,
});

export const approveSchema = Joi.object({ note: Joi.string().max(300).allow(null, '') });
export const reasonSchema = Joi.object({ reason: Joi.string().min(3).max(400).required() });

export const holdSchema = Joi.object({
  lineIds: Joi.array().items(objectId),
  vendorId: objectId,
  reason: Joi.string().valid(...Object.values(PAYOUT_HOLD_REASON)).default('manual'),
  note: Joi.string().max(300).allow(null, ''),
}).or('lineIds', 'vendorId');

export const releaseSchema = Joi.object({
  lineIds: Joi.array().items(objectId).min(1).required(),
});

export const adjustmentSchema = Joi.object({
  vendorId: objectId.required(),
  amount: Joi.number().required().invalid(0), // rupees, signed
  reasonCode: Joi.string().valid(...Object.values(PAYOUT_ADJUSTMENT_REASON)).required(),
  note: Joi.string().max(400).allow(null, ''),
  orderId: objectId,
});

export const payoutAccountSchema = Joi.object({
  method: Joi.string().valid(...Object.values(PAYOUT_METHOD)).required(),
  accountHolderName: Joi.string().min(2).max(120).required(),
  accountNumber: Joi.string().min(6).max(20).when('method', { is: 'bank', then: Joi.required() }),
  ifsc: Joi.string().length(11).uppercase().when('method', { is: 'bank', then: Joi.required() }),
  bankName: Joi.string().max(120).allow(null, ''),
  vpa: Joi.string().max(100).when('method', { is: 'upi', then: Joi.required() }),
});

export const kycSchema = Joi.object({
  pan: Joi.string().length(10).uppercase().required(),
  gstin: Joi.string().length(15).uppercase().allow(null, ''),
  documents: Joi.array().items(objectId),
});

export const kycReviewSchema = Joi.object({
  status: Joi.string().valid('approved', 'rejected').required(),
  rejectionReason: Joi.string().max(300).allow(null, ''),
});

export const payoutPolicySchema = Joi.object({
  scope: Joi.string().valid('platform', 'vendor'),
  vendorId: objectId,
  schedule: Joi.string().max(20),
  minPayoutPaise: Joi.number().integer().min(0),
  returnWindowDays: Joi.number().integer().min(0).max(90),
  perishableReturnWindowDays: Joi.number().integer().min(0).max(90),
  requirePspSettlement: Joi.boolean(),
  commissionGstBps: Joi.number().integer().min(0).max(10000),
  deductions: Joi.object({
    commission: Joi.boolean(), gstOnCommission: Joi.boolean(),
    tcs: Joi.boolean(), tds: Joi.boolean(),
  }),
  holdOnDispute: Joi.boolean(),
  negativeBalanceCarryForward: Joi.boolean(),
  dualApprovalPaise: Joi.number().integer().min(0),
  maxBatchPaise: Joi.number().integer().min(0),
});

export const settlementIngestSchema = Joi.object({
  reference: Joi.string().max(120).allow(null, ''),
  rows: Joi.array().items(Joi.object({
    orderId: objectId,
    orderNumber: Joi.string().max(40),
    amount: Joi.number().min(0),
    amountPaise: Joi.number().integer().min(0),
    settledAt: Joi.date().iso(),
    utr: Joi.string().max(40).allow(null, ''),
  }).or('orderId', 'orderNumber')).min(1).required(),
});
