/**
 * WalletTransaction — append-only ledger for wallet movements (bounded rows).
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';
import { WALLET_TXN_TYPE, WALLET_TXN_REASON } from '../constants/enums.js';

const { Schema, Types } = mongoose;

const WalletTransactionSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    walletId: { type: Types.ObjectId, ref: 'Wallet', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(WALLET_TXN_TYPE), required: true },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    reason: { type: String, enum: Object.values(WALLET_TXN_REASON), required: true },
    refType: { type: String, default: null, maxlength: 40 }, // e.g. 'refund', 'order'
    refId: { type: Types.ObjectId, default: null },
    note: { type: String, default: null, maxlength: 300 },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'wallettransactions' }
);

WalletTransactionSchema.index({ walletId: 1, createdAt: -1 });
WalletTransactionSchema.index({ userId: 1, createdAt: -1 });

WalletTransactionSchema.plugin(auditPlugin);
WalletTransactionSchema.plugin(softDeletePlugin);
WalletTransactionSchema.plugin(toJSONPlugin);

export default mongoose.model('WalletTransaction', WalletTransactionSchema);
