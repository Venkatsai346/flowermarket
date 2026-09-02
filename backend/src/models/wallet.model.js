/**
 * Wallet — customer wallet for instant refunds & goodwill credits.
 * `balance` updated via versioned read-modify-write (optimistic lock) to avoid
 * lost updates under concurrent credits/debits.
 */

import mongoose from 'mongoose';
import { softDeletePlugin, auditPlugin, toJSONPlugin } from './plugins/index.js';

const { Schema, Types } = mongoose;

const WalletSchema = new Schema(
  {
    tenantId: { type: Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    balance: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'INR', maxlength: 8 },
    version: { type: Number, default: 1, min: 1 },
  },
  { collection: 'wallets' }
);

WalletSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

WalletSchema.plugin(auditPlugin);
WalletSchema.plugin(softDeletePlugin);
WalletSchema.plugin(toJSONPlugin);

export default mongoose.model('Wallet', WalletSchema);
