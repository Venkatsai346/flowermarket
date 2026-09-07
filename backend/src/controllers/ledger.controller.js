import ledgerService from '../services/ledger.service.js';
import AccountBalance from '../models/accountBalance.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';
import { serializeList } from '../utils/serialize.js';
import { fromPaise } from '../utils/money.js';
import { LEDGER_ACCOUNT_TYPE } from '../constants/enums.js';

/**
 * LedgerController — the read side of the general ledger (Phase 6.3 / M6).
 *
 * Read-only by design: there is no endpoint that posts a journal. Money only
 * moves through the business services (order saga, refunds, payouts), each of
 * which posts its own balanced journal. Exposing a "post arbitrary journal"
 * API would defeat the point of having a ledger at all.
 */
class LedgerController {
  /** Every account with its natural balance — the reconciliation dashboard. */
  accounts = asyncHandler(async (req, res) => {
    const rows = await AccountBalance.find({}).sort({ accountCode: 1 }).lean();
    const items = serializeList(rows).map((r) => {
      const debitPositive = r.type === LEDGER_ACCOUNT_TYPE.ASSET || r.type === LEDGER_ACCOUNT_TYPE.EXPENSE;
      const balancePaise = debitPositive
        ? r.debitTotalPaise - r.creditTotalPaise
        : r.creditTotalPaise - r.debitTotalPaise;
      return { ...r, balancePaise, balance: fromPaise(balancePaise), debit: fromPaise(r.debitTotalPaise), credit: fromPaise(r.creditTotalPaise) };
    });
    res.status(200).json(success(items, { message: 'Ledger accounts fetched' }));
  });

  /** One account's entries, newest first. */
  statement = asyncHandler(async (req, res) => {
    const result = await ledgerService.statement({
      accountCode: req.query.accountCode,
      from: req.query.from || null,
      to: req.query.to || null,
      page: Number(req.query.page) || 1,
      limit: Math.min(200, Number(req.query.limit) || 50),
    });
    res.status(200).json(success(result, { meta: result.meta, message: 'Statement fetched' }));
  });

  /** Σ debits === Σ credits across every entry ever written. */
  trialBalance = asyncHandler(async (req, res) => {
    const tb = await ledgerService.trialBalance();
    res.status(200).json(success({
      ...tb,
      totalDebit: fromPaise(tb.totalDebitPaise),
      totalCredit: fromPaise(tb.totalCreditPaise),
      difference: fromPaise(tb.differencePaise),
    }, { message: tb.balanced ? 'Ledger is balanced' : 'LEDGER IS UNBALANCED' }));
  });

  /** Recompute balances from entries; `repair=true` rewrites the view. */
  verify = asyncHandler(async (req, res) => {
    const result = await ledgerService.verifyBalances({ repair: req.body?.repair === true });
    res.status(200).json(success(result, {
      message: result.ok ? 'No drift' : `${result.drifted.length} account(s) drifted`,
    }));
  });

  /** Every journal touching one business reference (e.g. an order). */
  journals = asyncHandler(async (req, res) => {
    const rows = await ledgerService.journalsFor({ refType: req.query.refType, refId: req.query.refId });
    res.status(200).json(success(serializeList(rows).map((j) => ({ ...j, total: fromPaise(j.totalPaise) })), { message: 'Journals fetched' }));
  });

  /**
   * Platform-wide integrity report (Phase 10) — one structured answer for
   * "is the system consistent?": ledger (trial + balances + event↔journal
   * coverage), search index, slots, webhook audit, payouts, notification lag.
   */
  integrity = asyncHandler(async (req, res) => {
    const { default: integrityService } = await import('../services/integrity.service.js');
    const report = await integrityService.report({});
    res.status(200).json(success(report, {
      message: report.overall === 'ok' ? 'System consistent' : 'Drift detected — see checks',
    }));
  });

  /**
   * Rebuild the ledger/audit from the domain event store (Phase 10). The ONLY
   * write path in this controller — and only ever re-posts idempotently what
   * the event store already promises, so it can never invent money.
   */
  replay = asyncHandler(async (req, res) => {
    const { default: integrityService } = await import('../services/integrity.service.js');
    const out = await integrityService.replay({ limit: Number(req.body?.limit) || 200 });
    res.status(200).json(success(out, {
      message: `Replayed: ${out.journalsReposted} journal(s) re-posted, ${out.eventsRestored} event(s) restored`,
    }));
  });

  /**
   * Phase 11 — anchor unanchored audit rows into the hash chain. Safe and
   * additive (only touches seq-null rows, stable order). Deliberately does
   * NOT repair chain breaks: re-linking a broken chain would re-hash the
   * tampered content and bless it. Breaks stay visible for a human.
   */
  replayChain = asyncHandler(async (req, res) => {
    const { default: domainEventService } = await import('../services/domainEvent.service.js');
    const out = await domainEventService.repairChain({ limit: Number(req.body?.limit) || 500 });
    res.status(200).json(success(out, {
      message: `Chain: ${out.anchored} row(s) anchored`,
    }));
  });

  /**
   * Phase 11 — deliberate re-link of the audit chain after a legitimate
   * row-set change (e.g. an event restored from its journal). Manual only:
   * it changes every hash and records a `chain_rebuilt` fact, which is what
   * keeps it distinct from tampering (an unrepaired break stays visible).
   */
  rebuildChain = asyncHandler(async (req, res) => {
    const { default: domainEventService } = await import('../services/domainEvent.service.js');
    const out = await domainEventService.rebuildChain({ limit: Number(req.body?.limit) || 100000 });
    res.status(200).json(success(out, {
      message: `Chain re-linked: ${out.relinked} row(s)`,
    }));
  });
}

export default new LedgerController();
