import mongoose from 'mongoose';
import Wallet from '../models/wallet.model.js';
import LedgerEntry from '../models/ledgerEntry.model.js';
import WalletTransaction from '../models/walletTransaction.model.js';
import { badRequest, notFound } from '../utils/ApiError.js';
import { roundMoney } from '../utils/money.js';
import { serializeList } from '../utils/serialize.js';
import { generateOpaqueToken } from '../utils/hash.js';
import { WALLET_TXN_TYPE, WALLET_TXN_REASON, DOMAIN_EVENT_TYPE, LEDGER_JOURNAL_KIND } from '../constants/enums.js';
import config from '../config/index.js';
import paymentProvider from './paymentProvider.service.js';
import domainEventService from './domainEvent.service.js';
import ledgerPostingService from './ledgerPosting.service.js';
import { default as ledgerService, ledgerAccounts } from './ledger.service.js';

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

    // Phase 16: non-refund credits raise wallet liability without gateway
    // money behind them — post the journal so the books never drift from
    // the wallets. (REFUND credits are journaled by refund.service's
    // postRefund; ORDER_PAYMENT debits by the sale journal.)
    if (reason === WALLET_TXN_REASON.GOODWILL) {
      await domainEventService.append({
        tenantId,
        kind: DOMAIN_EVENT_TYPE.WALLET_TOPUP,
        aggregateType: 'wallet_transaction',
        aggregateId: txn._id,
        idempotencyKey: `${LEDGER_JOURNAL_KIND.WALLET_TOPUP}:wallet_txn:${txn._id}`,
        occurredAt: new Date(),
        refType: 'wallet_transaction',
        refId: txn._id,
        payload: { amountPaise: Math.round(value * 100), userId: String(userId), counter: ledgerAccounts.walletGoodwillExpense(), goodwill: true },
      });
      await ledgerPostingService.safePost('wallet_goodwill', () =>
        ledgerPostingService.postWalletTopup({ walletTransaction: txn, goodwill: true }));
    }

    return { wallet: updated, txn };
  }

  /**
   * Phase 16: the customer wallet IS a ledger account. This is the check
   * that proves it: the sum of every wallet balance must equal the
   * `customer_wallet_liability` balance, to the paise.
   *
   * A difference means money moved in one world without the other (a
   * pre-Phase-16 top-up, a missed journal, a manual edit). `repair: true`
   * posts a single `wallet_backfill` journal for the difference — the
   * audit trail records exactly what was reconciled and when.
   */
  async ledgerReconcile({ tenantId = null, repair = false } = {}) {
    const tId = tenantId
      ? (tenantId instanceof mongoose.Types.ObjectId ? tenantId : new mongoose.Types.ObjectId(String(tenantId)))
      : null;
    const q = tId ? { tenantId: tId } : {};
    const liabCode = ledgerAccounts.walletLiability();
    const [agg, count, entries] = await Promise.all([
      Wallet.aggregate([
        { $match: q },
        { $group: { _id: null, total: { $sum: '$balance' } } },
      ]),
      Wallet.countDocuments(q),
      // tenant-scoped liability straight from the ENTRIES (the journal is
      // the truth; the materialized view is platform-wide and covered by
      // verifyBalances)
      LedgerEntry.aggregate([
        { $match: { accountCode: liabCode, ...q } },
        { $group: { _id: null, debit: { $sum: '$debitPaise' }, credit: { $sum: '$creditPaise' } } },
      ]),
    ]);
    const walletTotalPaise = Math.round((agg[0]?.total || 0) * 100);
    // liability account: credits raise it, debits reduce it
    const ledgerTotalPaise = (entries) => (entries[0]?.credit || 0) - (entries[0]?.debit || 0);
    const fetchEntries = () => LedgerEntry.aggregate([
      { $match: { accountCode: liabCode, ...q } },
      { $group: { _id: null, debit: { $sum: '$debitPaise' }, credit: { $sum: '$creditPaise' } } },
    ]);
    let ledgerPaise = ledgerTotalPaise(entries);
    let differencePaise = walletTotalPaise - ledgerPaise;
    let repaired = null;

    if (repair && differencePaise !== 0) {
      const key = `wallet_backfill:${tenantId || 'platform'}:${new Date().toISOString()}`;
      const diff = Math.abs(differencePaise);
      const lines = differencePaise > 0
        ? [
          { accountCode: ledgerAccounts.gatewayClearing(), debitPaise: diff, creditPaise: 0, memo: 'wallet backfill: pre-ledger wallet balances (credits)' },
          { accountCode: ledgerAccounts.walletLiability(), debitPaise: 0, creditPaise: diff, memo: 'wallet backfill' },
        ]
        : [
          { accountCode: ledgerAccounts.walletLiability(), debitPaise: diff, creditPaise: 0, memo: 'wallet backfill: pre-ledger wallet balances (debits)' },
          { accountCode: ledgerAccounts.gatewayClearing(), debitPaise: 0, creditPaise: diff, memo: 'wallet backfill' },
        ];
      await domainEventService.append({
        tenantId,
        kind: DOMAIN_EVENT_TYPE.WALLET_BACKFILL,
        aggregateType: 'wallet',
        aggregateId: tenantId || 'platform',
        idempotencyKey: key,
        occurredAt: new Date(),
        refType: 'wallet',
        refId: tenantId || 'platform',
        payload: { differencePaise },
      });
      const post = await ledgerService.post({
        kind: LEDGER_JOURNAL_KIND.WALLET_BACKFILL,
        idempotencyKey: key,
        lines,
        refType: 'wallet',
        refId: null,
        tenantId: tId,
        meta: { differencePaise, repairedAt: new Date() },
      });
      repaired = { idempotencyKey: key, differencePaise, posted: post.created };
      // report the POST-repair state so callers can rely on `balanced`
      ledgerPaise = ledgerTotalPaise(await fetchEntries());
      differencePaise = walletTotalPaise - ledgerPaise;
    }

    return {
      wallets: count,
      walletTotalPaise,
      ledgerPaise,
      differencePaise,
      balanced: differencePaise === 0,
      repaired,
    };
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
    // Phase 16: real money entered the platform — the liability we now owe
    // the customer must sit on the books (DR clearing / CR wallet
    // liability), event first so a crash window is replayable.
    await domainEventService.append({
      tenantId,
      kind: DOMAIN_EVENT_TYPE.WALLET_TOPUP,
      aggregateType: 'wallet_transaction',
      aggregateId: txn._id,
      idempotencyKey: `${LEDGER_JOURNAL_KIND.WALLET_TOPUP}:wallet_txn:${txn._id}`,
      occurredAt: txn.completedAt || new Date(),
      refType: 'wallet_transaction',
      refId: txn._id,
      payload: { amountPaise: Math.round(value * 100), userId: String(userId), counter: ledgerAccounts.gatewayClearing() },
    });
    await ledgerPostingService.safePost('wallet_topup', () =>
      ledgerPostingService.postWalletTopup({ walletTransaction: txn }));
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
