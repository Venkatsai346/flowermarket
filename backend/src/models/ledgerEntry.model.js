/**
 * LedgerEntry — the flattened, queryable side of the journal (Phase 6.1).
 *
 * Every journal line is also written here as its own document so that account
 * statements, reconciliation and drift verification are simple indexed queries
 * instead of `$unwind` pipelines over journals.
 *
 * This is a DERIVED collection: the journal is the source of truth. If entries
 * and journals ever disagree, the journal wins and `ledgerService.verifyBalances()`
 * reports it. Entries are never updated — only inserted (append-only).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { LEDGER_JOURNAL_KIND } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const LedgerEntrySchema = new Schema(
  {
    journalId: { type: Types.ObjectId, ref: 'LedgerJournal', required: true, index: true },
    kind: { type: String, enum: Object.values(LEDGER_JOURNAL_KIND), required: true },

    accountCode: { type: String, required: true, index: true, maxlength: 120 },
    debitPaise: { type: Number, default: 0, min: 0 },
    creditPaise: { type: Number, default: 0, min: 0 },

    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },
    vendorId: { type: Types.ObjectId, ref: 'Vendor', default: null, index: true },
    refType: { type: String, default: null, maxlength: 40 },
    refId: { type: Types.ObjectId, default: null, index: true },
    memo: { type: String, default: null, maxlength: 200 },

    occurredAt: { type: Date, required: true, index: true },
    currency: { type: String, default: 'INR', maxlength: 8 },
  },
  { collection: 'ledgerentries' }
);

// statement query: one account, ordered in time
LedgerEntrySchema.index({ accountCode: 1, occurredAt: -1 });
// drift verification: group by account
LedgerEntrySchema.index({ accountCode: 1, journalId: 1 });

LedgerEntrySchema.plugin(auditPlugin);
LedgerEntrySchema.plugin(softDeletePlugin);
LedgerEntrySchema.plugin(toJSONPlugin);

export default mongoose.model('LedgerEntry', LedgerEntrySchema);
