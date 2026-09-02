import mongoose from 'mongoose';
import LedgerJournal from '../models/ledgerJournal.model.js';
import LedgerEntry from '../models/ledgerEntry.model.js';
import LedgerAccount from '../models/ledgerAccount.model.js';
import AccountBalance from '../models/accountBalance.model.js';
import config from '../config/index.js';
import { AppError, badRequest, notFound } from '../utils/ApiError.js';
import { sumPaise, allocatePaise, fromPaise } from '../utils/money.js';
import { serializeList } from '../utils/serialize.js';
import {
  LEDGER_ACCOUNT,
  LEDGER_ACCOUNT_PREFIX,
  LEDGER_ACCOUNT_TYPE,
  LEDGER_JOURNAL_KIND,
} from '../constants/enums.js';

/**
 * LedgerService — the double-entry general ledger (Phase 6.1).
 *
 * WHY THIS EXISTS
 * Vendor payouts and GST invoicing both answer the question "who is owed what,
 * and can we prove it?". Answering that by summing order rows on demand is how
 * marketplaces end up paying twice. A ledger makes every rupee a pair of
 * entries, makes reconciliation a query, and makes "we lost a paisa" a test
 * failure rather than an audit finding.
 *
 * THE FOUR RULES (all enforced in code, all covered by scripts/money.test.js
 * and scripts/smoke-ledger.test.js):
 *  1. Every journal balances: Σ debitPaise === Σ creditPaise, or nothing is written.
 *  2. Every journal is idempotent on `{kind}:{refType}:{refId}` — replaying a
 *     webhook, retrying a saga step or re-running a backfill posts nothing new.
 *  3. Journals are immutable. Corrections are reversing journals, never edits.
 *  4. The journal is the truth; `accountbalances` is a materialized view that
 *     can always be recomputed (`verifyBalances`).
 *
 * TRANSACTIONS
 * When the deployment is a replica set, journal + entries + balances commit in
 * one transaction. On a standalone mongod (the current dev default) the same
 * code runs without a session and the nightly `verifyBalances({repair:true})`
 * closes any crash window. Capability is probed once and cached.
 */

// ---------------------------------------------------------------------------
// account code builders — the string format lives here and nowhere else
// ---------------------------------------------------------------------------

export const ledgerAccounts = {
  gatewayClearing: () => LEDGER_ACCOUNT.GATEWAY_CLEARING,
  bank: () => LEDGER_ACCOUNT.BANK,
  commissionIncome: () => LEDGER_ACCOUNT.PLATFORM_COMMISSION_INCOME,
  tcsPayable: () => LEDGER_ACCOUNT.TCS_PAYABLE,
  tdsPayable: () => LEDGER_ACCOUNT.TDS_PAYABLE,
  walletLiability: () => LEDGER_ACCOUNT.CUSTOMER_WALLET_LIABILITY,
  roundingDifference: () => LEDGER_ACCOUNT.ROUNDING_DIFFERENCE,
  vendorPayable: (vendorId) => `${LEDGER_ACCOUNT_PREFIX.VENDOR_PAYABLE}:${vendorId}`,
  tenantPayable: (tenantId) => `${LEDGER_ACCOUNT_PREFIX.TENANT_PAYABLE}:${tenantId}`,
  gstOutputPayable: (ownerId) => `${LEDGER_ACCOUNT_PREFIX.GST_OUTPUT_PAYABLE}:${ownerId}`,
  refundClawback: (vendorId) => `${LEDGER_ACCOUNT_PREFIX.REFUND_CLAWBACK}:${vendorId}`,
};

/** Account type inference from the code — keeps posting call-sites tiny. */
const TYPE_BY_PREFIX = {
  [LEDGER_ACCOUNT.GATEWAY_CLEARING]: LEDGER_ACCOUNT_TYPE.ASSET,
  [LEDGER_ACCOUNT.BANK]: LEDGER_ACCOUNT_TYPE.ASSET,
  [LEDGER_ACCOUNT.PLATFORM_COMMISSION_INCOME]: LEDGER_ACCOUNT_TYPE.INCOME,
  [LEDGER_ACCOUNT.TCS_PAYABLE]: LEDGER_ACCOUNT_TYPE.LIABILITY,
  [LEDGER_ACCOUNT.TDS_PAYABLE]: LEDGER_ACCOUNT_TYPE.LIABILITY,
  [LEDGER_ACCOUNT.CUSTOMER_WALLET_LIABILITY]: LEDGER_ACCOUNT_TYPE.LIABILITY,
  [LEDGER_ACCOUNT.ROUNDING_DIFFERENCE]: LEDGER_ACCOUNT_TYPE.EXPENSE,
  [LEDGER_ACCOUNT_PREFIX.VENDOR_PAYABLE]: LEDGER_ACCOUNT_TYPE.LIABILITY,
  [LEDGER_ACCOUNT_PREFIX.TENANT_PAYABLE]: LEDGER_ACCOUNT_TYPE.LIABILITY,
  [LEDGER_ACCOUNT_PREFIX.GST_OUTPUT_PAYABLE]: LEDGER_ACCOUNT_TYPE.LIABILITY,
  [LEDGER_ACCOUNT_PREFIX.REFUND_CLAWBACK]: LEDGER_ACCOUNT_TYPE.ASSET,
};

export function accountTypeFor(code) {
  const prefix = String(code).split(':')[0];
  const type = TYPE_BY_PREFIX[prefix];
  if (!type) throw badRequest(`Unknown ledger account: ${code}`, 'LEDGER_UNKNOWN_ACCOUNT');
  return type;
}

const ACCOUNT_NAMES = {
  [LEDGER_ACCOUNT.GATEWAY_CLEARING]: 'Payment gateway clearing',
  [LEDGER_ACCOUNT.BANK]: 'Platform settlement bank',
  [LEDGER_ACCOUNT.PLATFORM_COMMISSION_INCOME]: 'Platform commission income',
  [LEDGER_ACCOUNT.TCS_PAYABLE]: 'TCS payable (GST s.52)',
  [LEDGER_ACCOUNT.TDS_PAYABLE]: 'TDS payable (IT s.194-O)',
  [LEDGER_ACCOUNT.CUSTOMER_WALLET_LIABILITY]: 'Customer wallet liability',
  [LEDGER_ACCOUNT.ROUNDING_DIFFERENCE]: 'Rounding difference',
  [LEDGER_ACCOUNT_PREFIX.VENDOR_PAYABLE]: 'Vendor payable',
  [LEDGER_ACCOUNT_PREFIX.TENANT_PAYABLE]: 'Store payable',
  [LEDGER_ACCOUNT_PREFIX.GST_OUTPUT_PAYABLE]: 'GST output payable',
  [LEDGER_ACCOUNT_PREFIX.REFUND_CLAWBACK]: 'Refund clawback receivable',
};

function accountNameFor(code) {
  const [prefix, owner] = String(code).split(':');
  const base = ACCOUNT_NAMES[prefix] || prefix;
  return owner ? `${base} — ${owner}` : base;
}

const toId = (v) => (v == null ? null : (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v))));

class LedgerService {
  constructor() {
    this._txnSupported = null; // null = not probed yet
  }

  // -------------------------------------------------------------------------
  // infrastructure
  // -------------------------------------------------------------------------

  /**
   * Probe once whether this deployment supports multi-document transactions
   * (i.e. is a replica set / mongos). Cached for the process lifetime.
   */
  async transactionsSupported() {
    if (config.ledger.disableTransactions) return false;
    if (this._txnSupported !== null) return this._txnSupported;
    try {
      const admin = mongoose.connection.db?.admin();
      const info = await admin?.command({ hello: 1 });
      this._txnSupported = Boolean(info?.setName || info?.msg === 'isdbgrid');
    } catch {
      this._txnSupported = false;
    }
    return this._txnSupported;
  }

  /** Run `fn(session|null)` inside a transaction when the server supports one. */
  async withOptionalTransaction(fn) {
    if (!(await this.transactionsSupported())) return fn(null);
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => { result = await fn(session); });
      return result;
    } finally {
      await session.endSession();
    }
  }

  /** Seed the global (unscoped) accounts. Idempotent — safe on every boot. */
  async ensureChartOfAccounts() {
    const codes = Object.values(LEDGER_ACCOUNT);
    await Promise.all(codes.map((code) => LedgerAccount.updateOne(
      { code },
      {
        $setOnInsert: {
          code,
          type: accountTypeFor(code),
          name: accountNameFor(code),
          isSystem: true,
          currency: config.ledger.baseCurrency,
        },
      },
      { upsert: true }
    )));
    return codes.length;
  }

  // -------------------------------------------------------------------------
  // posting
  // -------------------------------------------------------------------------

  /**
   * Post a balanced journal. THE single write path into the ledger.
   *
   * @param {object} p
   * @param {string} p.kind            LEDGER_JOURNAL_KIND
   * @param {string} p.idempotencyKey  unique; `{kind}:{refType}:{refId}` by convention
   * @param {Array}  p.lines           [{ accountCode, debitPaise?, creditPaise?, refType?, refId?, memo? }]
   * @param {string} [p.refType] @param {string} [p.refId]
   * @param {string} [p.tenantId] @param {string} [p.vendorId]
   * @param {Date}   [p.occurredAt]    business time (defaults to now)
   * @returns {Promise<{journal, created:boolean}>}
   */
  async post({
    kind, idempotencyKey, lines = [], refType = null, refId = null,
    tenantId = null, vendorId = null, occurredAt = null, postedBy = null, meta = null,
  }) {
    if (!kind || !LEDGER_JOURNAL_KIND[String(kind).toUpperCase()]) {
      if (!Object.values(LEDGER_JOURNAL_KIND).includes(kind)) {
        throw badRequest(`Unknown journal kind: ${kind}`, 'LEDGER_BAD_KIND');
      }
    }
    if (!idempotencyKey) throw badRequest('idempotencyKey is required', 'LEDGER_KEY_REQUIRED');

    // ---- normalize + validate lines ----
    const normalized = lines
      .map((l) => ({
        accountCode: String(l.accountCode),
        debitPaise: Math.round(Number(l.debitPaise) || 0),
        creditPaise: Math.round(Number(l.creditPaise) || 0),
        refType: l.refType || refType || null,
        refId: toId(l.refId ?? refId),
        memo: l.memo || null,
      }))
      // drop true no-ops (a zero-value allocation slice is legitimate but useless)
      .filter((l) => l.debitPaise !== 0 || l.creditPaise !== 0);

    if (normalized.length === 0) throw badRequest('Journal has no non-zero lines', 'LEDGER_EMPTY');

    for (const l of normalized) {
      if (l.debitPaise < 0 || l.creditPaise < 0) {
        throw badRequest('Ledger amounts must be non-negative — use the opposite side instead of a negative amount', 'LEDGER_NEGATIVE_AMOUNT');
      }
      if (l.debitPaise > 0 && l.creditPaise > 0) {
        throw badRequest('A ledger line is either a debit or a credit, never both', 'LEDGER_BOTH_SIDES');
      }
      accountTypeFor(l.accountCode); // throws on an unknown account
    }

    const debits = sumPaise(...normalized.map((l) => l.debitPaise));
    const credits = sumPaise(...normalized.map((l) => l.creditPaise));
    if (debits !== credits) {
      throw new AppError(
        `Journal does not balance: debits ${debits} ≠ credits ${credits} (paise)`,
        { status: 422, code: 'LEDGER_UNBALANCED', details: { kind, idempotencyKey, debits, credits } }
      );
    }

    // ---- idempotency: same event already posted? ----
    const existing = await LedgerJournal.findOne({ idempotencyKey });
    if (existing) return { journal: existing, created: false };

    const when = occurredAt ? new Date(occurredAt) : new Date();
    const tId = toId(tenantId);
    const vId = toId(vendorId);

    try {
      const journal = await this.withOptionalTransaction(async (session) => {
        const opts = session ? { session } : {};

        const [created] = await LedgerJournal.create([{
          kind,
          idempotencyKey,
          tenantId: tId,
          vendorId: vId,
          refType,
          refId: toId(refId),
          lines: normalized,
          totalPaise: debits,
          currency: config.ledger.baseCurrency,
          occurredAt: when,
          postedAt: new Date(),
          postedBy: toId(postedBy),
          meta,
        }], opts);

        await LedgerEntry.insertMany(
          normalized.map((l) => ({
            journalId: created._id,
            kind,
            accountCode: l.accountCode,
            debitPaise: l.debitPaise,
            creditPaise: l.creditPaise,
            tenantId: tId,
            vendorId: vId,
            refType: l.refType,
            refId: l.refId,
            memo: l.memo,
            occurredAt: when,
            currency: config.ledger.baseCurrency,
          })),
          session ? { session, ordered: true } : { ordered: true }
        );

        await this.applyToBalances({ lines: normalized, journal: created, tenantId: tId, vendorId: vId, session });
        return created;
      });

      return { journal, created: true };
    } catch (err) {
      // Unique-index race: another request posted the same event first.
      if (err?.code === 11000) {
        const raced = await LedgerJournal.findOne({ idempotencyKey });
        if (raced) return { journal: raced, created: false };
      }
      throw err;
    }
  }

  /** Fold journal lines into the materialized balances (atomic `$inc`). */
  async applyToBalances({ lines, journal, tenantId = null, vendorId = null, session = null }) {
    const byAccount = new Map();
    for (const l of lines) {
      const cur = byAccount.get(l.accountCode) || { debit: 0, credit: 0, n: 0 };
      cur.debit += l.debitPaise;
      cur.credit += l.creditPaise;
      cur.n += 1;
      byAccount.set(l.accountCode, cur);
    }

    const ops = [...byAccount.entries()].map(([accountCode, agg]) => ({
      updateOne: {
        filter: { accountCode },
        update: {
          $inc: { debitTotalPaise: agg.debit, creditTotalPaise: agg.credit, entryCount: agg.n },
          $set: { lastJournalId: journal._id, lastPostedAt: journal.postedAt },
          $setOnInsert: {
            accountCode,
            type: accountTypeFor(accountCode),
            tenantId: accountCode.startsWith(LEDGER_ACCOUNT_PREFIX.TENANT_PAYABLE) ? tenantId : (tenantId || null),
            vendorId: accountCode.startsWith(LEDGER_ACCOUNT_PREFIX.VENDOR_PAYABLE) ? vendorId : (vendorId || null),
            currency: config.ledger.baseCurrency,
          },
        },
        upsert: true,
      },
    }));

    if (ops.length) await AccountBalance.bulkWrite(ops, session ? { session } : {});

    // lazily register any account we've never seen before
    await Promise.all([...byAccount.keys()].map((code) => LedgerAccount.updateOne(
      { code },
      {
        $setOnInsert: {
          code,
          type: accountTypeFor(code),
          name: accountNameFor(code),
          tenantId: tenantId || null,
          vendorId: vendorId || null,
          currency: config.ledger.baseCurrency,
        },
      },
      { upsert: true, ...(session ? { session } : {}) }
    )));
  }

  /**
   * Reverse (part of) an existing journal, proportionally across the side that
   * received the money.
   *
   * This is how a refund is posted: instead of guessing which vendor/tax/
   * commission accounts to touch, we read the ORIGINAL sale journal and give
   * back a proportional slice of exactly what it credited. That guarantees:
   *   - we can never reverse an account the sale never touched,
   *   - we can never reverse more than was posted (`reversedPaise` guard),
   *   - the reversal balances by construction.
   *
   * @param {object} p
   * @param {string} p.originalKey     idempotencyKey of the journal to reverse
   * @param {number} p.amountPaise     how much to reverse (≤ remaining)
   * @param {string} p.counterAccount  where the money goes (wallet liability / gateway clearing)
   * @param {string} p.kind            journal kind for the reversal
   * @param {string} p.idempotencyKey  unique key for THIS reversal
   */
  async reverseProportional({
    originalKey, amountPaise, counterAccount, kind = LEDGER_JOURNAL_KIND.REFUND_ISSUED,
    idempotencyKey, refType = null, refId = null, occurredAt = null, memo = null, postedBy = null,
  }) {
    const amount = Math.round(Number(amountPaise) || 0);
    if (amount <= 0) throw badRequest('Reversal amount must be positive', 'LEDGER_INVALID_AMOUNT');

    const original = await LedgerJournal.findOne({ idempotencyKey: originalKey });
    if (!original) throw notFound(`No journal to reverse: ${originalKey}`, 'LEDGER_ORIGINAL_NOT_FOUND');

    const remaining = original.totalPaise - (original.reversedPaise || 0);
    if (amount > remaining) {
      throw new AppError(
        `Cannot reverse ${amount} paise — only ${remaining} remain unreversed on ${originalKey}`,
        { status: 409, code: 'LEDGER_OVER_REVERSAL', details: { originalKey, amount, remaining } }
      );
    }

    // The credit side of the original journal is what we hand back.
    const creditLines = original.lines.filter((l) => l.creditPaise > 0);
    const shares = allocatePaise(amount, creditLines.map((l) => l.creditPaise));

    const lines = creditLines
      .map((l, i) => ({
        accountCode: l.accountCode,
        debitPaise: shares[i],
        creditPaise: 0,
        refType: l.refType,
        refId: l.refId,
        memo: memo || `reversal of ${originalKey}`,
      }))
      .filter((l) => l.debitPaise > 0);

    lines.push({
      accountCode: counterAccount,
      debitPaise: 0,
      creditPaise: amount,
      refType,
      refId,
      memo: memo || `reversal of ${originalKey}`,
    });

    const result = await this.post({
      kind,
      idempotencyKey,
      lines,
      refType,
      refId,
      tenantId: original.tenantId,
      vendorId: original.vendorId,
      occurredAt,
      postedBy,
      meta: { reversalOf: String(original._id), originalKey },
    });

    if (result.created) {
      await LedgerJournal.updateOne(
        { _id: result.journal._id },
        { $set: { reversalOf: original._id } }
      );
      await LedgerJournal.updateOne(
        { _id: original._id },
        { $inc: { reversedPaise: amount } }
      );
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------------

  /** O(1) balance read from the materialized view. */
  async balance(accountCode) {
    const row = await AccountBalance.findOne({ accountCode }).lean();
    if (!row) {
      return { accountCode, type: accountTypeFor(accountCode), debitTotalPaise: 0, creditTotalPaise: 0, balancePaise: 0, balance: 0, entryCount: 0 };
    }
    const debitPositive = row.type === LEDGER_ACCOUNT_TYPE.ASSET || row.type === LEDGER_ACCOUNT_TYPE.EXPENSE;
    const balancePaise = debitPositive
      ? row.debitTotalPaise - row.creditTotalPaise
      : row.creditTotalPaise - row.debitTotalPaise;
    return { ...row, id: String(row._id), balancePaise, balance: fromPaise(balancePaise) };
  }

  /** Recompute a single account's balance straight from the entries. */
  async computedBalance(accountCode) {
    const [agg] = await LedgerEntry.aggregate([
      { $match: { accountCode } },
      { $group: { _id: null, debit: { $sum: '$debitPaise' }, credit: { $sum: '$creditPaise' }, n: { $sum: 1 } } },
    ]);
    const type = accountTypeFor(accountCode);
    const debitPositive = type === LEDGER_ACCOUNT_TYPE.ASSET || type === LEDGER_ACCOUNT_TYPE.EXPENSE;
    const debit = agg?.debit || 0;
    const credit = agg?.credit || 0;
    return {
      accountCode,
      type,
      debitTotalPaise: debit,
      creditTotalPaise: credit,
      entryCount: agg?.n || 0,
      balancePaise: debitPositive ? debit - credit : credit - debit,
    };
  }

  /** Account statement (paginated, newest first). */
  async statement({ accountCode, from = null, to = null, page = 1, limit = 50 }) {
    const q = { accountCode };
    if (from || to) {
      q.occurredAt = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      };
    }
    const skip = (Math.max(1, page) - 1) * limit;
    const [docs, total, bal] = await Promise.all([
      LedgerEntry.find(q).sort({ occurredAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      LedgerEntry.countDocuments(q),
      this.balance(accountCode),
    ]);
    return {
      account: bal,
      items: serializeList(docs).map((d) => ({
        ...d,
        debit: fromPaise(d.debitPaise),
        credit: fromPaise(d.creditPaise),
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: skip + docs.length < total },
    };
  }

  /** Journals for a business reference (e.g. every journal touching an order). */
  async journalsFor({ refType, refId }) {
    return LedgerJournal.find({ refType, refId: toId(refId) }).sort({ occurredAt: 1 }).lean();
  }

  // -------------------------------------------------------------------------
  // integrity
  // -------------------------------------------------------------------------

  /**
   * Recompute every account from `ledgerentries` and compare with the
   * materialized `accountbalances`.
   *
   * Returns `{ checked, drifted: [...], repaired }`. Drift must be zero; the
   * nightly job alerts when it isn't. `repair:true` rewrites the view from the
   * entries (the entries are never modified).
   */
  async verifyBalances({ repair = false } = {}) {
    const computed = await LedgerEntry.aggregate([
      {
        $group: {
          _id: '$accountCode',
          debit: { $sum: '$debitPaise' },
          credit: { $sum: '$creditPaise' },
          n: { $sum: 1 },
        },
      },
    ]);

    const stored = await AccountBalance.find({}).lean();
    const storedByCode = new Map(stored.map((s) => [s.accountCode, s]));

    const drifted = [];
    for (const c of computed) {
      const s = storedByCode.get(c._id);
      const sd = s?.debitTotalPaise || 0;
      const sc = s?.creditTotalPaise || 0;
      if (sd !== c.debit || sc !== c.credit) {
        drifted.push({
          accountCode: c._id,
          storedDebitPaise: sd,
          storedCreditPaise: sc,
          computedDebitPaise: c.debit,
          computedCreditPaise: c.credit,
          driftPaise: (c.debit - c.credit) - (sd - sc),
        });
      }
      storedByCode.delete(c._id);
    }
    // balances with no entries at all
    for (const [code, s] of storedByCode) {
      if (s.debitTotalPaise !== 0 || s.creditTotalPaise !== 0) {
        drifted.push({
          accountCode: code,
          storedDebitPaise: s.debitTotalPaise,
          storedCreditPaise: s.creditTotalPaise,
          computedDebitPaise: 0,
          computedCreditPaise: 0,
          driftPaise: -(s.debitTotalPaise - s.creditTotalPaise),
        });
      }
    }

    let repaired = 0;
    if (repair && drifted.length) {
      for (const d of drifted) {
        await AccountBalance.updateOne(
          { accountCode: d.accountCode },
          {
            $set: {
              debitTotalPaise: d.computedDebitPaise,
              creditTotalPaise: d.computedCreditPaise,
            },
            $setOnInsert: { accountCode: d.accountCode, type: accountTypeFor(d.accountCode) },
          },
          { upsert: true }
        );
        repaired += 1;
      }
    }

    return { checked: computed.length, drifted, repaired, ok: drifted.length === 0 };
  }

  /**
   * Global trial balance: across every account, Σ debits must equal Σ credits.
   * If this is ever false, a journal was written unbalanced — which `post()`
   * makes impossible, so a failure here means data was modified outside the
   * service.
   */
  async trialBalance() {
    const [agg] = await LedgerEntry.aggregate([
      { $group: { _id: null, debit: { $sum: '$debitPaise' }, credit: { $sum: '$creditPaise' }, n: { $sum: 1 } } },
    ]);
    const debit = agg?.debit || 0;
    const credit = agg?.credit || 0;
    return {
      totalDebitPaise: debit,
      totalCreditPaise: credit,
      differencePaise: debit - credit,
      entries: agg?.n || 0,
      balanced: debit === credit,
    };
  }
}

export default new LedgerService();
