import DomainEvent from '../models/domainEvent.model.js';
import Order from '../models/order.model.js';
import RefundTransaction from '../models/refundTransaction.model.js';
import PayoutBatch from '../models/payoutBatch.model.js';
import LedgerJournal from '../models/ledgerJournal.model.js';
import { DOMAIN_EVENT_TYPE, DOMAIN_EVENT_JOURNAL_KINDS, LEDGER_JOURNAL_KIND, ORDER_STATUS, REFUND_TRANSACTION_STATUS } from '../constants/enums.js';

/**
 * DomainEventService — the append-only money audit backbone (Phase 10).
 *
 * Two jobs:
 *   1. `append()` — record a money fact exactly once (unique idempotencyKey).
 *      Called at the FACT (order confirmed, refund completed, payout
 *      submitted), in the same call path as the ledger journal it documents.
 *   2. `replay()` / `findDrift()` — the ledger is a PROJECTION of this store.
 *      `findDrift()` reports any journal-carrying event with no journal (a
 *      crash between fact and post) or any money journal with no event (an
 *      un-audited posting). `replay()` re-posts the missing side
 *      idempotently, rebuilding the ledger from the event store.
 *
 * The event payload is an AUDIT SUMMARY, not a copy of the journal lines —
 * replay re-derives the journal from the aggregate (OrderItem /
 * RefundTransaction / PayoutBatch) through the SAME idempotent post functions
 * the live path uses, so a rebuilt journal is byte-for-byte the live one.
 *
 * `append()` never throws: the audit store aids the ledger, it does not gate
 * it. A failed append is logged and is healed later by `replay()`.
 */

class DomainEventService {
  /**
   * Append a domain event exactly once. `idempotencyKey` must be stable for
   * the fact (for journal-carrying kinds it is the journal's idempotencyKey).
   * @returns {Promise<{created:boolean, duplicate?:boolean, event?:object}>}
   */
  async append({
    tenantId = null, traceId = null, kind, aggregateType, aggregateId,
    idempotencyKey = null, payload = null, occurredAt = null,
    refType = null, refId = null, schemaVersion = 1,
  }) {
    try {
      const event = await DomainEvent.create({
        tenantId, traceId, kind, schemaVersion,
        aggregateType, aggregateId: String(aggregateId),
        refType, refId: refId ? String(refId) : null,
        idempotencyKey, payload, occurredAt: occurredAt ? new Date(occurredAt) : null,
      });
      return { created: true, event };
    } catch (err) {
      if (err?.code === 11000) {
        const existing = idempotencyKey
          ? await DomainEvent.findOne({ idempotencyKey }).lean()
          : null;
        return { created: false, duplicate: true, event: existing };
      }
      // eslint-disable-next-line no-console
      console.error(`[domain-events] append ${kind}/${aggregateId} failed:`, err?.message || err);
      return { created: false, error: err?.message || String(err) };
    }
  }

  /** All events for one trace (the "follow the money" chain), oldest first. */
  async forTrace(traceId) {
    if (!traceId) return [];
    return DomainEvent.find({ traceId }).sort({ occurredAt: 1, createdAt: 1 }).lean();
  }

  /** All events for one aggregate (an order's full money history). */
  async forAggregate(aggregateType, aggregateId, { limit = 100 } = {}) {
    return DomainEvent.find({
      aggregateType, aggregateId: String(aggregateId),
    }).sort({ occurredAt: 1, createdAt: 1 }).limit(limit).lean();
  }

  /** Counts + recency, for the integrity report and dashboards. */
  async stats({ tenantId = null } = {}) {
    const q = tenantId ? { tenantId } : {};
    const [total, byKind, recency] = await Promise.all([
      DomainEvent.countDocuments(q),
      DomainEvent.aggregate([
        ...(tenantId ? [{ $match: { tenantId } }] : []),
        { $group: { _id: '$kind', n: { $sum: 1 } } },
      ]),
      DomainEvent.find(q).sort({ occurredAt: -1, createdAt: -1 }).limit(1).lean(),
    ]);
    return {
      total,
      byKind: Object.fromEntries(byKind.map((r) => [r._id, r.n])),
      newestOccurredAt: recency[0]?.occurredAt || null,
    };
  }

  /**
   * Drift between the event store and the ledger, in BOTH directions:
   *   - `missingJournals` — a journal-carrying event with no matching journal
   *     (crashed between the fact and the post; or a swallowed non-strict post).
   *   - `missingEvents`   — a money journal with no matching event
   *     (a posting that bypassed the audit backbone; pre-Phase-10 history).
   *
   * The join is exact: for journal-carrying kinds the event's idempotencyKey
   * IS the journal's idempotencyKey.
   */
  async findDrift({ tenantId = null, limit = 500 } = {}) {
    const events = await DomainEvent.find({
      kind: { $in: DOMAIN_EVENT_JOURNAL_KINDS },
      ...(tenantId ? { tenantId } : {}),
    }).select('idempotencyKey kind aggregateType aggregateId traceId occurredAt').sort({ occurredAt: 1 }).limit(limit * 3).lean();

    const keys = events.map((e) => e.idempotencyKey).filter(Boolean);
    const journals = keys.length
      ? await LedgerJournal.find({ idempotencyKey: { $in: keys } }).select('idempotencyKey').lean()
      : [];
    const journalKeys = new Set(journals.map((j) => j.idempotencyKey));

    const missingJournals = events.filter((e) => e.idempotencyKey && !journalKeys.has(e.idempotencyKey));

    // reverse direction: money journals whose event is absent
    const moneyKinds = [
      LEDGER_JOURNAL_KIND.SALE_CAPTURED,
      LEDGER_JOURNAL_KIND.REFUND_ISSUED,
      LEDGER_JOURNAL_KIND.PAYOUT_INITIATED,
      LEDGER_JOURNAL_KIND.PAYOUT_REVERSED,
    ];
    const jQ = { kind: { $in: moneyKinds } };
    if (tenantId) jQ.tenantId = tenantId;
    const allJournals = await LedgerJournal.find(jQ).select('idempotencyKey kind').sort({ postedAt: 1 }).limit(limit * 3).lean();
    const eventKeys = new Set(events.map((e) => e.idempotencyKey));
    const missingEvents = allJournals.filter((j) => !eventKeys.has(j.idempotencyKey));

    return {
      eventsScanned: events.length,
      missingJournals: missingJournals.slice(0, limit),
      missingJournalsTotal: missingJournals.length,
      journalsScanned: allJournals.length,
      missingEvents: missingEvents.slice(0, limit),
      missingEventsTotal: missingEvents.length,
      ok: missingJournals.length === 0 && missingEvents.length === 0,
    };
  }

  /**
   * Rebuild the ledger from the event store (and vice-versa), idempotently.
   *
   *   - missingJournals → re-run the SAME idempotent post the live path used,
   *     re-deriving lines from the aggregate. A crash-window journal is
   *     rebuilt exactly.
   *   - missingEvents   → restore the audit row from the journal (so the
   *     backbone is complete for pre-Phase-10 history too).
   *
   * @returns {Promise<{journalsReposted, eventsRestored, skipped, failed:[]}>}
   */
  async replay({ limit = 200 } = {}) {
    const ledgerPostingService = (await import('./ledgerPosting.service.js')).default;
    const payoutService = (await import('./payout.service.js')).default;
    const drift = await this.findDrift({ limit });
    const out = { journalsReposted: 0, eventsRestored: 0, skipped: 0, failed: [] };

    // ---- 1. journals missing for a known event → re-post idempotently ----
    for (const e of drift.missingJournals) {
      try {
        await this._repostJournal(e, { ledgerPostingService, payoutService });
        out.journalsReposted += 1;
      } catch (err) {
        // aggregate gone / not yet payable → skip (re-try next run)
        out.skipped += 1;
        out.failed.push({ idempotencyKey: e.idempotencyKey, kind: e.kind, reason: err?.code || err?.message || String(err) });
      }
    }

    // ---- 2. events missing for a known journal → restore the audit row ----
    for (const stub of drift.missingEvents) {
      try {
        const full = await LedgerJournal.findOne({ idempotencyKey: stub.idempotencyKey }).lean();
        if (!full) { out.skipped += 1; continue; }
        await this._restoreEvent(full);
        out.eventsRestored += 1;
      } catch (err) {
        out.skipped += 1;
        out.failed.push({ idempotencyKey: stub.idempotencyKey, kind: 'restore_event', reason: err?.message || String(err) });
      }
    }

    return out;
  }

  /** Re-derive + post the journal an event promises. Idempotent by key. */
  async _repostJournal(e, { ledgerPostingService, payoutService }) {
    const id = e.aggregateId;
    switch (e.kind) {
      case DOMAIN_EVENT_TYPE.SALE_CAPTURED: {
        const order = await Order.findById(id);
        if (!order) throw Object.assign(new Error('order missing'), { code: 'ORDER_MISSING' });
        // only re-post genuinely paid, non-cancelled orders
        if (order.status === ORDER_STATUS.CANCELLED) throw Object.assign(new Error('order cancelled'), { code: 'ORDER_CANCELLED' });
        if (!order.paymentSummary?.paidAt && order.status === ORDER_STATUS.PAYMENT_PENDING) {
          throw Object.assign(new Error('not yet paid'), { code: 'NOT_PAID' });
        }
        await ledgerPostingService.postSaleCaptured({ order });
        return;
      }
      case DOMAIN_EVENT_TYPE.REFUND_ISSUED: {
        const rt = await RefundTransaction.findById(id);
        if (!rt) throw Object.assign(new Error('refund missing'), { code: 'REFUND_MISSING' });
        if (rt.status !== REFUND_TRANSACTION_STATUS.SUCCESS) throw Object.assign(new Error('refund not successful'), { code: 'REFUND_NOT_SUCCESS' });
        await ledgerPostingService.postRefund({ refundTransaction: rt });
        return;
      }
      case DOMAIN_EVENT_TYPE.PAYOUT_INITIATED: {
        const batch = await PayoutBatch.findById(id);
        if (!batch) throw Object.assign(new Error('payout batch missing'), { code: 'BATCH_MISSING' });
        await payoutService.postPayoutJournal(batch);
        return;
      }
      case DOMAIN_EVENT_TYPE.PAYOUT_REVERSED: {
        const batch = await PayoutBatch.findById(id);
        if (!batch) throw Object.assign(new Error('payout batch missing'), { code: 'BATCH_MISSING' });
        await payoutService.unwindPayoutJournal(batch, 'replay: restore reversal');
        return;
      }
      default:
        throw Object.assign(new Error(`no replay for kind ${e.kind}`), { code: 'NO_REPLAY' });
    }
  }

  /** Restore the audit row for a journal that bypassed the backbone. */
  async _restoreEvent(j) {
    const refId = j.refId ? String(j.refId) : null;
    const map = {
      [LEDGER_JOURNAL_KIND.SALE_CAPTURED]: {
        kind: DOMAIN_EVENT_TYPE.SALE_CAPTURED, aggregateType: 'order', aggregateId: j.refId,
        occurredAt: j.occurredAt, payload: { orderNumber: j.meta?.orderNumber, totalPaise: j.totalPaise, source: 'restored_from_journal' },
      },
      [LEDGER_JOURNAL_KIND.REFUND_ISSUED]: {
        kind: DOMAIN_EVENT_TYPE.REFUND_ISSUED, aggregateType: 'refund', aggregateId: j.refId,
        occurredAt: j.occurredAt, payload: { amountPaise: j.totalPaise, source: 'restored_from_journal' },
      },
      [LEDGER_JOURNAL_KIND.PAYOUT_INITIATED]: {
        kind: DOMAIN_EVENT_TYPE.PAYOUT_INITIATED, aggregateType: 'payout_batch', aggregateId: j.refId,
        occurredAt: j.occurredAt, payload: { netPaise: j.totalPaise, source: 'restored_from_journal' },
      },
      [LEDGER_JOURNAL_KIND.PAYOUT_REVERSED]: {
        kind: DOMAIN_EVENT_TYPE.PAYOUT_REVERSED, aggregateType: 'payout_batch', aggregateId: j.refId,
        occurredAt: j.occurredAt, payload: { amountPaise: j.totalPaise, source: 'restored_from_journal' },
      },
    }[j.kind];
    if (!map) throw Object.assign(new Error(`no event for journal kind ${j.kind}`), { code: 'NO_MAP' });
    await this.append({
      tenantId: j.tenantId, traceId: j.traceId || null,
      ...map,
      idempotencyKey: j.idempotencyKey,
      refType: j.refType, refId,
    });
  }
}

export default new DomainEventService();
