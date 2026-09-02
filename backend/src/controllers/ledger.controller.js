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
}

export default new LedgerController();
