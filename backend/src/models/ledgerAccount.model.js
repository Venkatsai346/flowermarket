/**
 * LedgerAccount — the chart of accounts (Phase 6.1).
 *
 * Accounts are created lazily the first time they are posted to (a vendor's
 * payable account appears when that vendor first sells), so there is no
 * migration to run when a vendor joins. The seeded global accounts
 * (gateway_clearing, bank, commission income, tax payables) come from
 * `ledgerService.ensureChartOfAccounts()`.
 *
 * `type` decides the natural balance side and is therefore not editable after
 * the first posting.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { LEDGER_ACCOUNT_TYPE } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const LedgerAccountSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true, maxlength: 120 },
    type: { type: String, enum: Object.values(LEDGER_ACCOUNT_TYPE), required: true },
    name: { type: String, required: true, maxlength: 160 },

    // owner scope (null for platform-level accounts)
    tenantId: { type: Types.ObjectId, ref: 'Tenant', default: null, index: true },
    vendorId: { type: Types.ObjectId, ref: 'Vendor', default: null, index: true },

    currency: { type: String, default: 'INR', maxlength: 8 },
    isSystem: { type: Boolean, default: false }, // seeded, never deletable
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { collection: 'ledgeraccounts' }
);

LedgerAccountSchema.plugin(auditPlugin);
LedgerAccountSchema.plugin(softDeletePlugin);
LedgerAccountSchema.plugin(toJSONPlugin);

export default mongoose.model('LedgerAccount', LedgerAccountSchema);
