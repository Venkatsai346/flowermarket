/**
 * AccountBalance — a MATERIALIZED VIEW of an account's running totals (Phase 6.1).
 *
 * IMPORTANT: this document is NOT the source of truth. `ledgerentries` is.
 * The balance exists so "what do we owe this vendor?" is an O(1) read instead
 * of an aggregation over every entry ever written.
 *
 * Consistency strategy (documented in uploads/phase6_*.md §2.4):
 *  - updates use `$inc`, which is atomic and immune to lost updates, so no
 *    optimistic-lock retry loop is needed here;
 *  - when the deployment supports transactions (replica set), the journal,
 *    the entries and this `$inc` all commit together;
 *  - when it does not, the journal is written FIRST (it is the truth) and any
 *    gap in this view is detected and repaired by
 *    `ledgerService.verifyBalances({ repair: true })`, which recomputes from
 *    entries. Drift is therefore always detectable and always fixable.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { LEDGER_ACCOUNT_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const AccountBalanceSchema = new Schema(
  {
    accountCode: { type: String, required: true, unique: true, index: true, maxlength: 120 },
    type: { type: String, enum: Object.values(LEDGER_ACCOUNT_TYPE), required: true },

    debitTotalPaise: { type: Number, default: 0 },
    creditTotalPaise: { type: Number, default: 0 },
    entryCount: { type: Number, default: 0 },

    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },
    vendorId: { type: Types.ObjectId, ref: 'Vendor', default: null, index: true },
    currency: { type: String, default: 'INR', maxlength: 8 },

    lastJournalId: { type: Types.ObjectId, ref: 'LedgerJournal', default: null },
    lastPostedAt: { type: Date, default: null },
  },
  { collection: 'accountbalances' }
);

/**
 * Natural balance in paise:
 *   asset/expense    -> debits − credits
 *   liability/income -> credits − debits
 */
AccountBalanceSchema.virtual('balancePaise').get(function balancePaise() {
  const debitPositive = this.type === LEDGER_ACCOUNT_TYPE.ASSET || this.type === LEDGER_ACCOUNT_TYPE.EXPENSE;
  return debitPositive
    ? this.debitTotalPaise - this.creditTotalPaise
    : this.creditTotalPaise - this.debitTotalPaise;
});

AccountBalanceSchema.plugin(auditPlugin);
AccountBalanceSchema.plugin(softDeletePlugin);
AccountBalanceSchema.plugin(toJSONPlugin);

export default mongoose.model('AccountBalance', AccountBalanceSchema);
