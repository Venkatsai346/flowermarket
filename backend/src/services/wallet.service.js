import Wallet from '../models/wallet.model.js';
import WalletTransaction from '../models/walletTransaction.model.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { roundMoney } from '../utils/money.js';
import { serializeList } from '../utils/serialize.js';
import { generateOpaqueToken } from '../utils/hash.js';
import { WALLET_TXN_TYPE, WALLET_TXN_REASON } from '../constants/enums.js';
import config from '../config/index.js';
import paymentProvider from './paymentProvider.service.js';

/**
 * WalletService — customer wallet (instant refunds & goodwill credits).
 * Balance updates are versioned (optimistic lock) to prevent lost updates.
 */
class WalletService {
  async getOrCreate({ tenantId, userId }) {
    let wallet = await Wallet.findOne({ tenantId, userId });
    if (!wallet) {
      wallet = await Wallet.create({ tenantId, userId, balance: 0, currency: 'INR' });
    }
    return wallet;
  }

  async getBalance({ tenantId, userId }) {
    const wallet = await this.getOrCreate({ tenantId, userId });
    return { balance: wallet.balance, currency: wallet.currency, walletId: wallet.id };
  }

  /** Credit the wallet (versioned). Returns { wallet, txn }. */
  async credit({ tenantId, userId, amount, reason, refType = null, refId = null, note = null }) {
    const value = roundMoney(amount);
    if (value <= 0) throw badRequest('Credit amount must be positive', 'INVALID_AMOUNT');
    const wallet = await this.getOrCreate({ tenantId, userId });
    const before = wallet.version;
    const newBalance = roundMoney(wallet.balance + value);
    const updated = await Wallet.findOneAndUpdate(
      { _id: wallet._id, version: before },
      { $set: { balance: newBalance, version: before + 1 } },
      { new: true }
    );
    if (!updated) {
      // retry once on version conflict
      return this.credit({ tenantId, userId, amount: value, reason, refType, refId, note });
    }
    const txn = await WalletTransaction.create({
      tenantId,
      walletId: updated._id,
      userId,
      type: WALLET_TXN_TYPE.CREDIT,
      amount: value,
      balanceAfter: updated.balance,
      reason,
      refType,
      refId,
      note,
    });
    return { wallet: updated, txn };
  }

  /** Debit the wallet (versioned). */
  /**
   * Wallet top-up — customer moves money INTO the wallet via the provider
   * (mock gateway in dev, Razorpay in prod). Synchronous charge semantics:
   * the provider confirms BEFORE we credit, so a top-up can never credit
   * money that was not collected. The gateway payment id is kept on the
   * wallet transaction for audit/traceability.
   */
  async topup({ tenantId, userId, amount }) {
    const value = roundMoney(amount);
    const { topupMin, topupMax } = config.wallet;
    if (!(value >= topupMin)) {
      throw badRequest(`Top-up minimum is Rs ${topupMin}`, 'TOPUP_BELOW_MINIMUM');
    }
    if (!(value <= topupMax)) {
      throw badRequest(`Top-up maximum is Rs ${topupMax}`, 'TOPUP_ABOVE_MAXIMUM');
    }
    const charge = await paymentProvider.charge({
      idempotencyKey: `topup_${generateOpaqueToken(12)}`,
      amount: value,
      currency: 'INR',
      method: 'wallet_topup',
    });
    if (!charge.success) {
      throw badRequest(
        charge.raw?.declined
          ? 'Top-up declined by the payment provider — try a different amount'
          : 'Top-up failed',
        'TOPUP_FAILED',
      );
    }
    // NOTE: refId is an ObjectId column — the gateway payment id is a
    // provider string, so it lives in the note (the Payment rows it would
    // link to are order-scoped and top-ups have no order).
    const { wallet, txn } = await this.credit({
      tenantId, userId, amount: value,
      reason: WALLET_TXN_REASON.TOPUP,
      refType: 'gateway_payment',
      refId: null,
      note: `Top-up via ${charge.provider}${charge.gatewayPaymentId ? ` (gateway ${charge.gatewayPaymentId})` : ''}`,
    });
    return { wallet, txn, gatewayPaymentId: charge.gatewayPaymentId || null, provider: charge.provider };
  }

  async debit({ tenantId, userId, amount, reason, refType = null, refId = null, note = null }) {
    const value = roundMoney(amount);
    if (value <= 0) throw badRequest('Debit amount must be positive', 'INVALID_AMOUNT');
    const wallet = await this.getOrCreate({ tenantId, userId });
    if (roundMoney(wallet.balance) < value) {
      throw badRequest('Insufficient wallet balance', 'INSUFFICIENT_WALLET_BALANCE');
    }
    const before = wallet.version;
    const newBalance = roundMoney(wallet.balance - value);
    const updated = await Wallet.findOneAndUpdate(
      { _id: wallet._id, version: before },
      { $set: { balance: newBalance, version: before + 1 } },
      { new: true }
    );
    if (!updated) return this.debit({ tenantId, userId, amount: value, reason, refType, refId, note });
    const txn = await WalletTransaction.create({
      tenantId,
      walletId: updated._id,
      userId,
      type: WALLET_TXN_TYPE.DEBIT,
      amount: value,
      balanceAfter: updated.balance,
      reason,
      refType,
      refId,
      note,
    });
    return { wallet: updated, txn };
  }

  async ledger({ tenantId, userId, page = 1, limit = 20 }) {
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      WalletTransaction.find({ tenantId, userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      WalletTransaction.countDocuments({ tenantId, userId }),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: skip + docs.length < total } };
  }
}

export default new WalletService();
