import mongoose from 'mongoose';

const { Schema, Types } = mongoose;

/**
 * BankStatementLine — one line of an ingested bank statement (Phase 14).
 *
 * The bank is an INDEPENDENT source of truth for the egress side of the
 * payout loop. A paid batch can later be returned (NSF, closed account)
 * long after the provider said "paid" — the only way to see that is the
 * bank's own record.
 *
 * Matching is UTR-exact and conservative:
 *   debit  (−) + UTR of a PROCESSING batch → the money moved: markPaid
 *   debit  (−) + UTR of a PAID batch       → bank confirms it: confirmed
 *   credit (+) + UTR of a PAID batch       → BANK RETURN: markReversed
 *   anything else                          → unmatched, visible, never guessed
 *
 * A line is immutable once matched; the batch it matched keeps the link
 * (matchStatus/matchedBatchId) and the money movement went through the
 * normal, chained payout service methods.
 */
const BankStatementLineSchema = new Schema({
  statementRef: { type: String, required: true, index: true }, // one ingestion batch, e.g. "BS-2026-09-07"
  lineNo: { type: Number, required: true, min: 1 },
  utr: { type: String, required: true, index: true, maxlength: 64 },
  amountPaise: { type: Number, required: true }, // signed: <0 debit (out), >0 credit (in)
  description: { type: String, default: null, maxlength: 300 },

  matchStatus: {
    type: String,
    enum: ['unmatched', 'confirmed_paid', 'returned'],
    default: 'unmatched',
    index: true,
  },
  matchError: { type: String, default: null, maxlength: 300 },
  matchedBatchId: { type: Types.ObjectId, ref: 'PayoutBatch', default: null },

  ingestedBy: { type: Types.ObjectId, ref: 'User', default: null },
  tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null },
}, { collection: 'bankstatementlines', timestamps: true });

BankStatementLineSchema.index({ statementRef: 1, lineNo: 1 }, { unique: true });
BankStatementLineSchema.index({ utr: 1, amountPaise: 1 });

export default mongoose.models.BankStatementLine || mongoose.model('BankStatementLine', BankStatementLineSchema);
