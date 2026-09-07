import mongoose from 'mongoose';
import { STATUTORY_STATUTE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

/**
 * StatutoryDeposit — one deposit of withheld TCS/TDS to the government.
 *
 * Payouts withhold TCS (GST s.52) and TDS (IT s.194-O) onto `tcs_payable` /
 * `tds_payable`. This record is the closing entry: the moment the platform
 * actually pays the government. Every deposit carries the UTR/receipt from
 * the deposit channel, is backed by a CHAINED domain event (tamper-evident,
 * replayable) and a balanced journal (DR {statute}_payable / CR bank).
 *
 * `reverted` deposits (operator corrections) keep their original journal and
 * gain a reversal journal — the net effect is zero and the trail is complete.
 */
const StatutoryDepositSchema = new Schema({
  tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },
  statute: { type: String, enum: Object.values(STATUTORY_STATUTE), required: true, index: true },

  amountPaise: { type: Number, required: true, min: 1 },
  utr: { type: String, required: true, maxlength: 64 }, // deposit-channel reference (CHAVS / 26Q ack)
  reference: { type: String, default: null, maxlength: 200 },

  status: {
    type: String,
    enum: ['recorded', 'reverted'],
    default: 'recorded',
    index: true,
  },
  journalId: { type: Types.ObjectId, ref: 'LedgerJournal', default: null },
  revertJournalId: { type: Types.ObjectId, ref: 'LedgerJournal', default: null },
  revertedAt: { type: Date, default: null },
  revertReason: { type: String, default: null, maxlength: 300 },

  // Phase 10 — the admin request that recorded it
  traceId: { type: String, default: null, index: true },
  recordedBy: { type: Types.ObjectId, ref: 'User', default: null },
  currency: { type: String, default: 'INR', maxlength: 8 },
}, { collection: 'statutorydeposits', timestamps: true });

StatutoryDepositSchema.index({ tenantId: 1, statute: 1, createdAt: -1 });

export default mongoose.models.StatutoryDeposit || mongoose.model('StatutoryDeposit', StatutoryDepositSchema);
