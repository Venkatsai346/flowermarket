import mongoose from 'mongoose';
import BankStatementLine from '../models/bankStatementLine.model.js';
import PayoutBatch from '../models/payoutBatch.model.js';
import payoutService from './payout.service.js';
import domainEventService from './domainEvent.service.js';
import { badRequest, notFound, conflict } from '../utils/ApiError.js';
import { PAYOUT_STATE, DOMAIN_EVENT_TYPE } from '../constants/enums.js';

/**
 * BankStatementService — the independent egress truth (Phase 14).
 *
 * The provider tells us what it THINKS happened; the bank statement tells us
 * what the money actually did. A PAID batch can be returned by the bank days
 * later (NSF, closed account) and the provider will never say so — only the
 * bank's own record reveals it. This service ingests statement lines and
 * matches them UTR-exact:
 *
 *   debit (−) + PROCESSING batch → the money moved: markPaid (resolves an
 *                                  ambiguous submission from the bank side)
 *   debit (−) + PAID batch       → confirmed_paid (the bank agrees)
 *   credit (+) + PAID batch      → BANK RETURN: markReversed (journal
 *                                  unwound, lines freed, event chained)
 *   anything else                → unmatched: visible in the queue, never
 *                                  guessed at
 *
 * The money movements themselves go through the normal payout service
 * methods (chained events, balanced journals) — the statement only DECIDES,
 * it never moves money directly. Re-ingesting the same statement is a
 * no-op (unique {statementRef, lineNo}).
 */
const toId = (v) => (v == null ? null : (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v))));

class BankStatementService {
  /**
   * @param {object} a { statementRef, lines: [{ utr, amountPaise (signed) | amount, description? }], actorId?, tenantId?, traceId? }
   */
  async ingest({ statementRef, lines = [], actorId = null, tenantId = null, traceId = null }) {
    if (!statementRef || String(statementRef).trim().length < 3) throw badRequest('statementRef is required (min 3 chars)', 'STATEMENT_REF_REQUIRED');
    const ref = String(statementRef).trim();
    if (!Array.isArray(lines) || !lines.length) throw badRequest('at least one statement line is required', 'STATEMENT_NO_LINES');

    // 1) persist the lines (idempotent per {statementRef, lineNo})
    const created = [];
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i];
      const paise = l.amountPaise ?? Math.round((Number(l.amount) || 0) * 100);
      if (!l.utr || String(l.utr).trim().length < 3) throw badRequest(`line ${i + 1}: utr is required`, 'STATEMENT_LINE_BAD');
      if (!paise) throw badRequest(`line ${i + 1}: amount must be non-zero`, 'STATEMENT_LINE_BAD');
      // eslint-disable-next-line no-await-in-loop
      const existing = await BankStatementLine.findOne({ statementRef: ref, lineNo: i + 1 });
      if (existing) continue; // re-ingest: keep the first record, never rematch
      // eslint-disable-next-line no-await-in-loop
      const line = await BankStatementLine.create({
        statementRef: ref, lineNo: i + 1, utr: String(l.utr).trim(),
        amountPaise: paise, description: l.description || null,
        ingestedBy: toId(actorId), tenantId: toId(tenantId),
      });
      created.push(line);
    }

    // 2) match the NEW lines only
    const out = { statementRef: ref, lines: lines.length, newLines: created.length, confirmed: 0, returned: 0, queued: 0, failed: [] };
    for (const line of created) {
      const res = await this._match(line, ref);
      if (res === 'confirmed_paid') out.confirmed += 1;
      else if (res === 'returned') out.returned += 1;
      else if (res === 'unmatched') out.queued += 1;
      else out.failed.push({ lineNo: line.lineNo, utr: line.utr, reason: res });
    }

    // 3) the ingestion itself is a chained fact (who fed us a statement, when)
    await domainEventService.append({
      tenantId: toId(tenantId),
      traceId: traceId || null,
      kind: DOMAIN_EVENT_TYPE.BANK_STATEMENT_INGESTED,
      aggregateType: 'bank_statement',
      aggregateId: ref,
      idempotencyKey: `bank_statement_ingested:${ref}`,
      refType: 'bank_statement',
      refId: ref,
      payload: { statementRef: ref, lines: lines.length, confirmed: out.confirmed, returned: out.returned, queued: out.queued },
    });

    return out;
  }

  /** UTR-exact match against payout batches; money moves only via payoutService. */
  async _match(line, ref) {
    const batch = await PayoutBatch.findOne({ utr: line.utr, state: { $in: [PAYOUT_STATE.PAID, PAYOUT_STATE.PROCESSING] } }).lean();
    if (!batch) {
      return 'unmatched';
    }
    try {
      const doc = await PayoutBatch.findById(batch._id);
      if (line.amountPaise < 0) {
        // money left our account
        if (doc.state === PAYOUT_STATE.PROCESSING) {
          await payoutService.markPaid({ batch: doc, utr: doc.utr });
        }
        // a PAID batch's own debit: the bank simply confirms it
        await BankStatementLine.updateOne({ _id: line._id }, { $set: { matchStatus: 'confirmed_paid', matchedBatchId: doc._id, matchedAt: new Date() } });
        return 'confirmed_paid';
      }
      // money came BACK — only meaningful against a paid batch
      if (doc.state === PAYOUT_STATE.PAID) {
        await payoutService.markReversed({ batch: doc, reason: `bank return per statement ${ref} (UTR ${line.utr})`, actorId: line.ingestedBy });
        await BankStatementLine.updateOne({ _id: line._id }, { $set: { matchStatus: 'returned', matchedBatchId: doc._id, matchedAt: new Date() } });
        return 'returned';
      }
      return 'unmatched';
    } catch (err) {
      const reason = String(err?.message || err).slice(0, 300);
      await BankStatementLine.updateOne({ _id: line._id }, { $set: { matchError: reason } });
      return reason;
    }
  }

  /** Reconciliation picture: totals by outcome + the unmatched queue. */
  async summary({ limit = 20 } = {}) {
    const [agg, queued, matched] = await Promise.all([
      BankStatementLine.aggregate([
        { $group: { _id: '$matchStatus', n: { $sum: 1 } } },
      ]),
      BankStatementLine.find({ matchStatus: 'unmatched' }).sort({ createdAt: -1 }).limit(limit).lean(),
      BankStatementLine.find({ matchStatus: { $in: ['confirmed_paid', 'returned'] } }).sort({ createdAt: -1 }).limit(limit).lean(),
    ]);
    const by = {};
    for (const r of agg) by[r._id] = r.n;
    return {
      total: Object.values(by).reduce((a, b) => a + b, 0),
      confirmed: by.confirmed_paid || 0,
      returned: by.returned || 0,
      unmatched: by.unmatched || 0,
      queued: queued.map((l) => ({
        statementRef: l.statementRef, lineNo: l.lineNo, utr: l.utr,
        amountPaise: l.amountPaise, description: l.description, createdAt: l.createdAt,
      })),
      recentMatches: matched.map((l) => ({
        statementRef: l.statementRef, utr: l.utr, amountPaise: l.amountPaise,
        matchStatus: l.matchStatus, batchNumber: null, createdAt: l.createdAt,
      })),
    };
  }

  /**
   * Delete a statement line (operator correction — a bad ingestion).
   * Only UNMATCHED lines may be deleted: a matched line already drove (or
   * confirmed) a money movement and is immutable — fix the batch instead.
   */
  async deleteLine({ statementRef, lineNo, actorId = null }) {
    const line = await BankStatementLine.findOne({ statementRef, lineNo });
    if (!line) throw notFound('Statement line not found', 'STATEMENT_LINE_NOT_FOUND');
    if (line.matchStatus !== 'unmatched') throw conflict('Matched statement lines are immutable — the batch link is the record', 'STATEMENT_LINE_MATCHED');
    await line.deleteOne();
    return { deleted: true, statementRef: line.statementRef, lineNo: line.lineNo, utr: line.utr, amountPaise: line.amountPaise };
  }
}

export default new BankStatementService();
