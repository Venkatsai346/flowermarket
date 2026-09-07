/**
 * FiscalPeriod — closeable accounting periods per tenant (Phase 11).
 *
 * A CLOSED period is IMMUTABLE: `ledgerService.post()` refuses any journal
 * whose `occurredAt` falls inside it (PERIOD_CLOSED). Reopening is an
 * explicit SUPER_ADMIN act, recorded as a domain event (period_reopened)
 * so the close/reopen history itself is in the tamper-evident chain.
 *
 * `periodKey` is 'YYYY-MM' (UTC month). `start`/`end` are the UTC month
 * bounds (end exclusive). Closing the in-progress month is allowed — it is
 * an operator decision (freeze the books); while closed, live money facts
 * accumulate as detectable drift in the integrity report until reopen.
 */

import mongoose from 'mongoose';
import { toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

export const FISCAL_PERIOD_STATE = Object.freeze({ OPEN: 'open', CLOSED: 'closed' });

const FiscalPeriodSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    periodKey: { type: String, required: true, match: /^\d{4}-\d{2}$/, maxlength: 7 },
    start: { type: Date, required: true },
    end: { type: Date, required: true }, // exclusive
    state: { type: String, enum: Object.values(FISCAL_PERIOD_STATE), default: FISCAL_PERIOD_STATE.OPEN },
    closedAt: { type: Date, default: null },
    closedBy: { type: Types.ObjectId, ref: 'User', default: null },
    reopenedAt: { type: Date, default: null },
    reopenedBy: { type: Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'fiscalperiods', timestamps: true }
);

FiscalPeriodSchema.index({ tenantId: 1, periodKey: 1 }, { unique: true });

toJSONPlugin(FiscalPeriodSchema);

const FiscalPeriod = mongoose.model('FiscalPeriod', FiscalPeriodSchema);
export default FiscalPeriod;
