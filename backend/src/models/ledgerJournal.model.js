/**
 * LedgerJournal — one balanced, immutable financial event (Phase 6.1).
 *
 * THE CONTRACT:
 *  - A journal is the atomic unit of money movement. Its entries always
 *    satisfy `Σ debitPaise === Σ creditPaise`; an unbalanced journal is
 *    rejected (422 LEDGER_UNBALANCED) and nothing is written.
 *  - `idempotencyKey` is UNIQUE and formatted `{kind}:{refType}:{refId}`, e.g.
 *    `sale_captured:order:66f0…a1`. Re-posting the same business event is a
 *    no-op that returns the existing journal — the same contract the rest of
 *    the codebase already uses for payments and refunds.
 *  - Journals are NEVER updated or deleted. A mistake is corrected by posting
 *    a reversing journal (`reversalOf`), exactly like a real GL.
 *  - `reversedPaise` tracks how much of this journal has already been reversed
 *    (partial refunds reverse a sale progressively) so we can never reverse
 *    more than was originally posted.
 *
 * Entries are embedded (not a separate collection) because a journal is a
 * bounded document — the entry count is O(order lines), and the whole journal
 * is always read and written together. LedgerEntry exists as a separate,
 * flattened collection for querying/statements (see ledgerEntry.model.js).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { LEDGER_JOURNAL_KIND } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const JournalLineSchema = new Schema(
  {
    accountCode: { type: String, required: true, maxlength: 120 },
    debitPaise: { type: Number, default: 0, min: 0 },
    creditPaise: { type: Number, default: 0, min: 0 },
    // what this line is about (order item, refund, payout batch, invoice…)
    refType: { type: String, default: null, maxlength: 40 },
    refId: { type: Types.ObjectId, default: null },
    memo: { type: String, default: null, maxlength: 200 },
  },
  { _id: false }
);

const LedgerJournalSchema = new Schema(
  {
    kind: { type: String, enum: Object.values(LEDGER_JOURNAL_KIND), required: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true },

    // scope — nullable for platform-level journals
    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },
    vendorId: { type: Types.ObjectId, ref: 'Vendor', default: null, index: true },

    // primary business reference
    refType: { type: String, default: null, maxlength: 40, index: true },
    refId: { type: Types.ObjectId, default: null, index: true },

    lines: { type: [JournalLineSchema], required: true },
    totalPaise: { type: Number, required: true, min: 0 }, // Σ debits (== Σ credits)
    currency: { type: String, default: 'INR', maxlength: 8 },

    occurredAt: { type: Date, default: Date.now, index: true }, // business time
    postedAt: { type: Date, default: Date.now },                // system time

    reversalOf: { type: Types.ObjectId, ref: 'LedgerJournal', default: null },
    reversedPaise: { type: Number, default: 0, min: 0 },

    postedBy: { type: Types.ObjectId, ref: 'User', default: null },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { collection: 'ledgerjournals' }
);

LedgerJournalSchema.index({ kind: 1, occurredAt: -1 });
LedgerJournalSchema.index({ refType: 1, refId: 1 });
LedgerJournalSchema.index({ tenantId: 1, occurredAt: -1 });

LedgerJournalSchema.plugin(auditPlugin);
LedgerJournalSchema.plugin(softDeletePlugin);
LedgerJournalSchema.plugin(toJSONPlugin);

export default mongoose.model('LedgerJournal', LedgerJournalSchema);
