import mongoose from 'mongoose';
import StatutoryDeposit from '../models/statutoryDeposit.model.js';
import ledgerService, { ledgerAccounts } from './ledger.service.js';
import domainEventService from './domainEvent.service.js';
import { AppError, badRequest, conflict, notFound } from '../utils/ApiError.js';
import { toPaise } from '../utils/money.js';
import {
  DOMAIN_EVENT_TYPE, LEDGER_JOURNAL_KIND, STATUTORY_STATUTE,
} from '../constants/enums.js';

/**
 * StatutoryService — the closing entry for the withholdings (Phase 13).
 *
 * Every paid payout credits `tcs_payable` (GST s.52) and `tds_payable`
 * (IT s.194-O): money the platform holds on behalf of the government.
 * This service pays it out:
 *
 *   DR tcs_payable / tds_payable        (liability cleared)
 *       CR bank                          (cash leaves our account)
 *
 * Discipline, same as every other money movement in this repo:
 *   1. the journal is guarded by the actual payable balance (you cannot
 *      deposit more than you withheld — 409 STATUTORY_OVER_DEPOSIT);
 *   2. a CHAINED domain event is appended BEFORE the journal (tamper-evident,
 *      replayable — a deleted deposit journal is re-posted by `replay()`);
 *   3. the UTR from the deposit channel is mandatory — a statutory payment
 *      without its reference is a compliance gap;
 *   4. reverts (operator corrections) never delete: they post a reversal
 *      journal and keep both, with the reason on the audit trail.
 */
const toId = (v) => (v == null ? null : (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v))));

const ACCOUNT_FOR = {
  [STATUTORY_STATUTE.TCS]: () => ledgerAccounts.tcsPayable(),
  [STATUTORY_STATUTE.TDS]: () => ledgerAccounts.tdsPayable(),
};

class StatutoryService {
  /**
   * Record a TCS/TDS deposit to the government.
   * @param {object} a { statute, amountPaise | amount, utr, reference?, tenantId?, occurredAt?, actorId? }
   */
  async deposit({ statute, amountPaise = null, amount = null, utr, reference = null, tenantId = null, occurredAt = null, actorId = null, traceId = null }) {
    if (!ACCOUNT_FOR[statute]) throw badRequest(`statute must be one of ${Object.values(STATUTORY_STATUTE).join(', ')}`, 'STATUTORY_BAD_STATUTE');
    const paise = amountPaise ?? toPaise(amount);
    if (!paise || paise <= 0) throw badRequest('amount must be positive', 'STATUTORY_BAD_AMOUNT');
    if (!utr || String(utr).trim().length < 3) throw badRequest('utr is required — the deposit-channel reference', 'STATUTORY_UTR_REQUIRED');

    const account = ACCOUNT_FOR[statute]();
    const balance = (await ledgerService.balance(account)).balancePaise;
    if (paise > balance) {
      throw new AppError(
        `Cannot deposit ₹${(paise / 100).toFixed(2)} ${statute.toUpperCase()} — only ₹${(balance / 100).toFixed(2)} withheld and undeposited`,
        { status: 409, code: 'STATUTORY_OVER_DEPOSIT', details: { statute, payableBalancePaise: balance, requestedPaise: paise } }
      );
    }

    const deposit = await StatutoryDeposit.create({
      tenantId: toId(tenantId),
      statute,
      amountPaise: paise,
      utr: String(utr).trim(),
      reference: reference || null,
      status: 'recorded',
      traceId: traceId || null,
      recordedBy: toId(actorId),
    });

    // event-first: the chained audit row exists before the money moves
    const event = await domainEventService.append({
      tenantId: toId(tenantId),
      traceId: traceId || null,
      kind: DOMAIN_EVENT_TYPE.STATUTORY_DEPOSIT,
      aggregateType: 'statutory_deposit',
      aggregateId: deposit._id,
      idempotencyKey: `statutory_deposit:${deposit._id}`,
      refType: 'statutory_deposit',
      refId: deposit._id,
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      payload: { statute, amountPaise: paise, utr: deposit.utr, reference: reference || null, accountCode: account },
    });

    const posted = await ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.STATUTORY_DEPOSIT,
      idempotencyKey: `statutory_deposit:${deposit._id}`,
      lines: [
        { accountCode: account, debitPaise: paise },
        { accountCode: ledgerAccounts.bank(), creditPaise: paise },
      ],
      refType: 'statutory_deposit',
      refId: deposit._id,
      tenantId: toId(tenantId),
      occurredAt: event?.occurredAt || new Date(),
      meta: { statute, utr: deposit.utr, reference: reference || null },
      traceId: event?.traceId || traceId || null,
    });

    deposit.journalId = posted.journal?._id || posted.journalId || null;
    await deposit.save();
    return deposit;
  }

  /**
   * Revert a deposit (operator correction — wrong amount / wrong statute).
   * Never deletes: posts DR bank / CR {statute}_payable and keeps the trail.
   */
  async revert({ depositId, reason = null, actorId = null, traceId = null, occurredAt = null }) {
    const deposit = await StatutoryDeposit.findById(depositId);
    if (!deposit) throw notFound('Statutory deposit not found', 'STATUTORY_DEPOSIT_NOT_FOUND');
    if (deposit.status === 'reverted') throw conflict('Already reverted', 'STATUTORY_ALREADY_REVERTED');
    if (!reason || String(reason).trim().length < 3) throw badRequest('a revert reason (min 3 chars) is required — it goes on the audit trail', 'STATUTORY_REVERT_REASON_REQUIRED');

    const account = ACCOUNT_FOR[deposit.statute]();
    const event = await domainEventService.append({
      tenantId: deposit.tenantId,
      traceId: traceId || deposit.traceId || null,
      kind: DOMAIN_EVENT_TYPE.STATUTORY_DEPOSIT_REVERTED,
      aggregateType: 'statutory_deposit',
      aggregateId: deposit._id,
      idempotencyKey: `statutory_deposit_reverted:${deposit._id}`,
      refType: 'statutory_deposit',
      refId: deposit._id,
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      payload: { statute: deposit.statute, amountPaise: deposit.amountPaise, utr: deposit.utr, reason: String(reason).trim(), accountCode: account },
    });

    const posted = await ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.STATUTORY_DEPOSIT_REVERTED,
      idempotencyKey: `statutory_deposit_reverted:${deposit._id}`,
      lines: [
        { accountCode: ledgerAccounts.bank(), debitPaise: deposit.amountPaise },
        { accountCode: account, creditPaise: deposit.amountPaise },
      ],
      refType: 'statutory_deposit',
      refId: deposit._id,
      tenantId: deposit.tenantId,
      occurredAt: event?.occurredAt || new Date(),
      meta: { statute: deposit.statute, originalUtr: deposit.utr, reason: String(reason).trim() },
      traceId: event?.traceId || deposit.traceId || null,
    });

    deposit.status = 'reverted';
    deposit.revertedAt = new Date();
    deposit.revertReason = String(reason).trim();
    deposit.revertJournalId = posted.journal?._id || posted.journalId || null;
    await deposit.save();
    return deposit;
  }

  /**
   * Statutory picture: for each statute — what is withheld (the payable
   * balance), what has been deposited (net of reverts), what is still owed.
   */
  async summary({ tenantId = null, limit = 20 } = {}) {
    const [tcs, tds, deposits] = await Promise.all([
      ledgerService.balance(ledgerAccounts.tcsPayable()),
      ledgerService.balance(ledgerAccounts.tdsPayable()),
      StatutoryDeposit.find({ ...(tenantId ? { tenantId } : {}) }).sort({ createdAt: -1 }).limit(limit).lean(),
    ]);

    // depositedPaise counts EVERY posted deposit journal (a reverted deposit
    // still moved cash out of the bank once); revertedPaise is the posted
    // reversals; netDepositedPaise is the cash the government actually kept.
    const byStatute = {};
    for (const d of deposits) {
      byStatute[d.statute] ||= { depositedPaise: 0, revertedPaise: 0, count: 0 };
      byStatute[d.statute].count += 1;
      byStatute[d.statute].depositedPaise += d.amountPaise;
      if (d.status === 'reverted') byStatute[d.statute].revertedPaise += d.amountPaise;
    }

    const row = (statute, bal) => {
      const d = byStatute[statute] || { depositedPaise: 0, revertedPaise: 0, count: 0 };
      return {
        statute,
        payableBalancePaise: bal.balancePaise,
        depositedPaise: d.depositedPaise,
        netDepositedPaise: d.depositedPaise - d.revertedPaise,
        revertedPaise: d.revertedPaise,
        deposits: d.count,
        // what is still owed to the government
        outstandingPaise: bal.balancePaise,
      };
    };

    return {
      tcs: row(STATUTORY_STATUTE.TCS, tcs),
      tds: row(STATUTORY_STATUTE.TDS, tds),
      recentDeposits: deposits.map((d) => ({
        id: String(d._id),
        statute: d.statute,
        amountPaise: d.amountPaise,
        utr: d.utr,
        status: d.status,
        createdAt: d.createdAt,
        revertReason: d.revertReason || null,
      })),
    };
  }
}

export default new StatutoryService();
