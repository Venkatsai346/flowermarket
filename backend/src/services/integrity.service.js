import ledgerService from './ledger.service.js';
import domainEventService from './domainEvent.service.js';
import searchIndexer from './searchIndexer.service.js';
import DeliverySlot from '../models/deliverySlot.model.js';
import Notification from '../models/notification.model.js';
import PaymentWebhookEvent from '../models/paymentWebhookEvent.model.js';
import PayoutBatch from '../models/payoutBatch.model.js';
import LedgerJournal from '../models/ledgerJournal.model.js';
import { NOTIFICATION_STATUS, LEDGER_JOURNAL_KIND, PAYOUT_STATE } from '../constants/enums.js';

/**
 * IntegrityService — the "is the system consistent?" report (Phase 10).
 *
 * One structured answer across every subsystem that holds state, composed of
 * the checks each subsystem already trusts:
 *
 *   ledger      trial balance + materialized-vs-entries (verifyBalances) +
 *               the NEW event↔journal coverage (the money audit backbone)
 *   searchIndex freshnessCheck (index vs live catalogue)
 *   slots       no slot may be reserved beyond its (overridable) capacity
 *   payments    webhook audit trail — mismatches are the fraud signal
 *   payouts     every disbursed batch must have its ledger journal
 *   events      the audit store's own shape (total / by kind / recency)
 *   notifications  outbox lag (pending + oldest), dead letters
 *
 * `report()` is READ-ONLY. `replay()` (the only write path) is the ledger
 * self-heal: re-post missing journals / restore missing audit rows from the
 * event store, idempotently.
 *
 * The nightly job runs report() per tenant and replays when the ledger
 * layer reports drift — so a crash between "money fact" and "journal" is
 * detected and healed automatically, not discovered by an auditor.
 */

class IntegrityService {
  /** Read-only consistency report. `tenantId` scopes the per-tenant checks. */
  async report({ tenantId = null } = {}) {
    const scope = tenantId ? { tenantId } : {};
    const [
      trial, balances, drift, search, slots, webhooks, payouts, events, notifications,
    ] = await Promise.all([
      ledgerService.trialBalance(),
      ledgerService.verifyBalances(),
      domainEventService.findDrift({ tenantId, limit: 50 }),
      searchIndexer.freshnessCheck().catch((e) => ({ error: e?.message || String(e) })),
      this._slotCheck(),
      this._webhookCheck(scope),
      this._payoutCheck(scope),
      domainEventService.stats({ tenantId }),
      this._notificationCheck(scope),
    ]);

    const ledger = {
      trial: { balanced: trial.balanced, differencePaise: trial.differencePaise, entries: trial.entries },
      balances: { checked: balances.checked, drifted: balances.drifted.length, ok: balances.ok },
      eventJournalCoverage: {
        eventsScanned: drift.eventsScanned,
        missingJournals: drift.missingJournalsTotal,
        missingEvents: drift.missingEventsTotal,
        samples: [
          ...drift.missingJournals.slice(0, 5).map((e) => ({ type: 'journal_missing', idempotencyKey: e.idempotencyKey, kind: e.kind })),
          ...drift.missingEvents.slice(0, 5).map((e) => ({ type: 'event_missing', idempotencyKey: e.idempotencyKey, kind: e.kind })),
        ],
        ok: drift.ok,
      },
      ok: trial.balanced && balances.ok && drift.ok,
    };

    const checks = {
      ledger,
      searchIndex: {
        indexedDocuments: search.indexedDocuments ?? 0,
        listings: search.listings ?? 0,
        missing: search.missing ?? 0,
        error: search.error || null,
        ok: !search.error && (search.missing ?? 0) === 0,
      },
      slots: { ...slots, overReserved: slots.overReserved, ok: slots.overReserved === 0 },
      payments: { ...webhooks, ok: webhooks.mismatches === 0 },
      payouts: { ...payouts, ok: payouts.missingJournals === 0 },
      events: { ...events, ok: true }, // the audit store has no "drift" — it is the reference
      notifications,
    };

    const overall = Object.values(checks)
      .every((c) => c.ok !== false) ? 'ok' : 'drift';

    return { generatedAt: new Date(), scope: tenantId ? String(tenantId) : 'platform', overall, checks };
  }

  /** The only write path — rebuild the ledger/audit from the event store. */
  async replay({ tenantId = null, limit = 200 } = {}) {
    const out = await domainEventService.replay({ limit });
    return { ...out, scope: tenantId ? String(tenantId) : 'platform' };
  }

  // -------------------------------------------------------------------------
  // per-subsystem checks
  // -------------------------------------------------------------------------

  /** A slot can never be reserved beyond its effective capacity. */
  async _slotCheck() {
    const overReserved = await DeliverySlot.aggregate([
      {
        $match: {
          $expr: {
            $gt: ['$reservedCapacity', { $ifNull: ['$manualCapacity', '$totalCapacity'] }],
          },
        },
      },
      { $project: { slotId: '$_id', date: 1, reserved: '$reservedCapacity', effective: { $ifNull: ['$manualCapacity', '$totalCapacity'] } } },
      { $limit: 20 },
    ]);
    return { checked: true, overReserved: overReserved.length, samples: overReserved };
  }

  /** Webhook audit: duplicates are expected; mismatches are the fraud signal. */
  async _webhookCheck(scope) {
    const byStatus = await PaymentWebhookEvent.aggregate([
      ...(scope.tenantId ? [{ $match: { tenantId: scope.tenantId } }] : []),
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const m = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
    return {
      total: byStatus.reduce((a, r) => a + r.n, 0),
      processed: m.processed || 0,
      duplicate: m.duplicate || 0,
      mismatch: m.mismatch || 0,
      ignored: m.ignored || 0,
      mismatches: m.mismatch || 0,
    };
  }

  /** Every submitted/disbursed payout batch must have its ledger journal. */
  async _payoutCheck(scope) {
    const batches = await PayoutBatch.find({
      state: { $in: [PAYOUT_STATE.PROCESSING, PAYOUT_STATE.PAID, PAYOUT_STATE.REJECTED, PAYOUT_STATE.REVERSED] },
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
    }).select('_id state').limit(500).lean();
    let missingJournals = 0;
    if (batches.length) {
      const ids = batches.map((b) => b._id);
      const journals = await LedgerJournal.find({
        kind: { $in: [LEDGER_JOURNAL_KIND.PAYOUT_INITIATED, LEDGER_JOURNAL_KIND.PAYOUT_REVERSED] },
        refId: { $in: ids },
      }).select('refId kind').lean();
      const covered = new Set(journals.map((j) => String(j.refId)));
      missingJournals = batches.filter((b) => !covered.has(String(b._id))).length;
    }
    return { batchesChecked: batches.length, missingJournals };
  }

  /** Notification outbox: how much is queued, how old is the oldest, dead letters. */
  async _notificationCheck(scope) {
    const [pending, oldest, failed] = await Promise.all([
      Notification.countDocuments({ status: NOTIFICATION_STATUS.PENDING, ...scope }),
      Notification.findOne({ status: NOTIFICATION_STATUS.PENDING, ...scope }).sort({ createdAt: 1 }).select('createdAt').lean(),
      Notification.countDocuments({ status: NOTIFICATION_STATUS.FAILED, ...scope }),
    ]);
    const oldestAgeMs = oldest?.createdAt ? Date.now() - oldest.createdAt.getTime() : 0;
    return {
      pending,
      oldestPendingAgeMs: oldestAgeMs,
      deadLetters: failed,
      ok: pending < 1000, // a huge backlog means the worker is stuck — flag it
    };
  }
}

export default new IntegrityService();
