import mongoose from 'mongoose';
import StatutoryDeposit from '../models/statutoryDeposit.model.js';
import PayoutBatch from '../models/payoutBatch.model.js';
import ledgerService, { ledgerAccounts } from './ledger.service.js';
import domainEventService from './domainEvent.service.js';
import { AppError, badRequest, conflict, notFound } from '../utils/ApiError.js';
import { toPaise } from '../utils/money.js';
import {
  DOMAIN_EVENT_TYPE, LEDGER_JOURNAL_KIND, STATUTORY_STATUTE, PAYOUT_STATE,
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
  // -------------------------------------------------------------------------
  // Phase 18 — statutory ledger integrity (the payables are real accounts)
  // -------------------------------------------------------------------------
  //
  // The books for {statute}_payable must equal the domain facts:
  //
  //   withheld  = Σ batch.{tcs,tds}Paise over batches whose PAYOUT_INITIATED
  //               journal is still live (state PROCESSING / PAID — the
  //               journal credits the payable at submission). A REVERSED or
  //               FAILED batch booked the credit AND posted the mirror
  //               unwind, netting to zero, so it is not withheld.
  //   expected  = withheld − net deposits (recorded − reverted)
  //   books     = the account balance
  //   drift     = expected − books   (> 0: books under-state the liability)
  //
  // The payables are platform-global (the account codes carry no tenant), so
  // the reconcile is platform-scoped.

  /** Reconcile one statute (or both when omitted). Read-only. */
  async reconcile({ statute = null } = {}) {
    const statutes = statute
      ? (ACCOUNT_FOR[statute] ? [statute] : (() => { throw badRequest(`statute must be one of ${Object.values(STATUTORY_STATUTE).join(', ')}`, 'STATUTORY_BAD_STATUTE'); })())
      : Object.values(STATUTORY_STATUTE);

    const [live, balances, deposits] = await Promise.all([
      PayoutBatch.find({ state: { $in: [PAYOUT_STATE.PROCESSING, PAYOUT_STATE.PAID] } }).lean(),
      Promise.all(statutes.map((s) => ledgerService.balance(ACCOUNT_FOR[s]()))),
      StatutoryDeposit.find({}).lean(),
    ]);

    const withheld = { [STATUTORY_STATUTE.TCS]: 0, [STATUTORY_STATUTE.TDS]: 0 };
    for (const b of live) {
      withheld[STATUTORY_STATUTE.TCS] += b.tcsPaise || 0;
      withheld[STATUTORY_STATUTE.TDS] += b.tdsPaise || 0;
    }
    const netDeposited = { [STATUTORY_STATUTE.TCS]: 0, [STATUTORY_STATUTE.TDS]: 0 };
    for (const d of deposits) {
      netDeposited[d.statute] += d.amountPaise;
      if (d.status === 'reverted') netDeposited[d.statute] -= d.amountPaise;
    }

    const rows = statutes.map((s, i) => {
      const expectedPaise = withheld[s] - netDeposited[s];
      const booksPaise = balances[i].balancePaise;
      const differencePaise = expectedPaise - booksPaise;
      return {
        statute: s,
        accountCode: ACCOUNT_FOR[s](),
        withheldPaise: withheld[s],
        netDepositedPaise: netDeposited[s],
        expectedPaise,
        booksPaise,
        differencePaise,
        balanced: differencePaise === 0,
      };
    });

    return rows.length === 1
      ? rows[0]
      : {
        statutes: rows,
        drifted: rows.filter((r) => !r.balanced).length,
        totalDifferencePaise: rows.reduce((a, r) => a + Math.abs(r.differencePaise), 0),
        ok: rows.every((r) => r.balanced),
      };
  }

  /**
   * Post ONE signed statutory_backfill journal for a drifted statute (repair).
   * Event-first with the journal's own idempotency key; the amount is the
   * measured difference — not re-derivable — so replay refuses it.
   */
  async postStatutoryBackfill({ statute, differencePaise, note = null, idempotencyKey = null }) {
    if (!ACCOUNT_FOR[statute]) throw badRequest(`statute must be one of ${Object.values(STATUTORY_STATUTE).join(', ')}`, 'STATUTORY_BAD_STATUTE');
    const diff = Math.round(Number(differencePaise) || 0);
    if (diff === 0) throw badRequest('Backfill difference must be non-zero', 'STATUTORY_BACKFILL_EMPTY');

    const key = idempotencyKey || `statutory_backfill:${statute}:${new Date().toISOString()}`;
    const account = ACCOUNT_FOR[statute]();
    const bank = ledgerAccounts.bank();
    // under-stated (diff > 0): the withheld money is owed and the bank is
    // short of the liability → DR bank / CR payable. Over-stated: the mirror.
    const lines = diff > 0
      ? [{ accountCode: bank, debitPaise: diff }, { accountCode: account, creditPaise: diff }]
      : [{ accountCode: account, debitPaise: -diff }, { accountCode: bank, creditPaise: -diff }];

    const event = await domainEventService.append({
      tenantId: null,
      kind: DOMAIN_EVENT_TYPE.STATUTORY_BACKFILL,
      aggregateType: 'statutory_payable',
      aggregateId: account,
      idempotencyKey: key,
      occurredAt: new Date(),
      refType: 'statutory_payable',
      refId: account,
      payload: { statute, differencePaise: diff, note: note || null },
    });

    const posted = await ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.STATUTORY_BACKFILL,
      idempotencyKey: key,
      lines,
      refType: 'statutory_payable',
      refId: null, // the account code is not an ObjectId — it lives in meta
      tenantId: null,
      occurredAt: event?.occurredAt || new Date(),
      meta: { statute, note: note || null },
    });
    return { posted: posted.created, idempotencyKey: key, journal: posted.journal || null };
  }

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
