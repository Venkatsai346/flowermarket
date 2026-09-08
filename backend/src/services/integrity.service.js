import ledgerService from './ledger.service.js';
import walletService from './wallet.service.js';
import payoutService from './payout.service.js';
import statutoryService from './statutory.service.js';
import domainEventService from './domainEvent.service.js';
import searchIndexer from './searchIndexer.service.js';
import DeliverySlot from '../models/deliverySlot.model.js';
import Notification from '../models/notification.model.js';
import PaymentWebhookEvent from '../models/paymentWebhookEvent.model.js';
import PayoutBatch from '../models/payoutBatch.model.js';
import LedgerJournal from '../models/ledgerJournal.model.js';
import Payment from '../models/payment.model.js';
import Order from '../models/order.model.js';
import { toPaise, sumPaise } from '../utils/money.js';
import {
  NOTIFICATION_STATUS,
  LEDGER_JOURNAL_KIND,
  PAYOUT_STATE,
  LEDGER_ACCOUNT,
  ORDER_STATUS,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
} from '../constants/enums.js';

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
 *   cod         cash receivable + cash on hand vs the payments behind them,
 *               and receivables stranded on cancelled orders
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
      trial, balances, drift, search, slots, webhooks, payouts, events, notifications, chain, wallet, vendors, statutory, gst, bank, cod,
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
      domainEventService.verifyChains({ tenantId }).catch((e) => ({ error: e?.message || String(e), ok: false })),
      this._walletCheck(scope),
      this._vendorCheck(),
      this._statutoryCheck(),
      this._gstCheck(),
      this._bankCheck(),
      this._codCheck(scope),
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
      wallet,
      // Phase 17: the vendor payable is a real ledger account — every vendor's
      // account must equal its unsettled payout lines + adjustments + carry.
      // Platform-scoped (vendors and payable accounts are platform-global).
      vendors,
      // Phase 18: the TCS/TDS payables are real ledger accounts — each must
      // equal withheld (live payout journals) − net deposits. Platform-scoped
      // (the payable accounts carry no tenant).
      statutory,
      gst,
      bank,
      // Cash on delivery: receivable and cash-on-hand must each agree with the
      // payments they summarise, and no receivable may survive a cancellation.
      cod,
      // Phase 11: the chain is the tamper-evidence layer. Breaks (edited,
      // deleted or re-ordered rows) are a DRIFT — the strongest signal in
      // the report. Unanchored rows are normal while repairChain catches up.
      auditChain: {
        tenants: chain.tenants ?? 0,
        eventsVerified: chain.eventsVerified ?? 0,
        unanchored: chain.unanchored ?? 0,
        breaks: (chain.breaks || []).slice(0, 10),
        error: chain.error || null,
        ok: !chain.error && (chain.breaks?.length ?? 0) === 0 && (chain.unanchored ?? 0) < 100,
      },
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

  /** Phase 16: wallet balances must equal the wallet-liability account. */
  async _walletCheck(scope) {
    try {
      const r = await walletService.ledgerReconcile({ tenantId: scope.tenantId || null });
      return { ...r, ok: r.balanced };
    } catch (e) {
      return { error: e?.message || String(e), ok: false };
    }
  }

  /** Phase 17: vendor payables must equal the payout lines owed to them. */
  async _vendorCheck() {
    try {
      const r = await payoutService.reconcileVendors({});
      return { ...r, ok: r.ok };
    } catch (e) {
      return { error: e?.message || String(e), ok: false };
    }
  }

  /** Phase 18: TCS/TDS payables must equal withheld − net deposits. */
  async _statutoryCheck() {
    try {
      const r = await statutoryService.reconcile({});
      return { ...r, ok: r.ok };
    } catch (e) {
      return { error: e?.message || String(e), ok: false };
    }
  }

  /** Seller GST output payable must equal sale credits − refund debits − live payout drains. */
  async _gstCheck() {
    try {
      const r = await payoutService.reconcileGst({});
      return { ...r, ok: r.ok };
    } catch (e) {
      return { error: e?.message || String(e), ok: false };
    }
  }

  /** Bank books must equal settled cash − live payout outflows − net statutory deposits. */
  async _bankCheck() {
    try {
      const r = await payoutService.reconcileBank({});
      return { ...r, ok: r.ok };
    } catch (e) {
      return { error: e?.message || String(e), ok: false };
    }
  }

  /**
   * Cash on delivery: the two cash accounts must agree with the Payments they
   * summarise, and no receivable may be stranded on a cancelled order.
   *
   * Cash is the one payment method where the books and the physical world can
   * drift apart without any gateway to contradict us — there is no PSP
   * statement saying "you never received this". So the reconciliation is
   * internal and exact:
   *
   *   cod_receivable  == Σ amount on COD payments still AWAITING_COLLECTION
   *   cash_on_hand    == Σ amountCollected on COD payments collected but not
   *                      yet banked
   *
   * A gap in the first means cash the books claim is owed that no order owes
   * (usually a cancellation that skipped the waiver). A gap in the second means
   * notes counted at a door that never reached the ledger, or ledger cash that
   * no rider is carrying — either way, money that cannot be found.
   *
   * `strandedReceivables` is reported separately from the balance gap because it
   * is the actionable one: an operator can chase a specific order id.
   */
  async _codCheck(scope) {
    try {
      const match = scope.tenantId ? { tenantId: scope.tenantId } : {};
      const [receivableAcct, cashAcct, awaiting, collectedUnbanked, stranded] = await Promise.all([
        ledgerService.balance(LEDGER_ACCOUNT.COD_RECEIVABLE),
        ledgerService.balance(LEDGER_ACCOUNT.CASH_ON_HAND),
        Payment.aggregate([
          { $match: { ...match, provider: PAYMENT_PROVIDER.COD, status: PAYMENT_STATUS.AWAITING_COLLECTION } },
          { $group: { _id: null, total: { $sum: '$amount' }, n: { $sum: 1 } } },
        ]),
        Payment.aggregate([
          {
            $match: {
              ...match,
              provider: PAYMENT_PROVIDER.COD,
              status: PAYMENT_STATUS.SUCCESS,
              collectedAt: { $ne: null },
              depositedAt: null,
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: { $ifNull: ['$amountCollected', '$amount'] } },
              n: { $sum: 1 },
            },
          },
        ]),
        // receivables still open on orders that are already CANCELLED — the
        // cancellation should have waived them
        Payment.find({
          ...match,
          provider: PAYMENT_PROVIDER.COD,
          status: PAYMENT_STATUS.AWAITING_COLLECTION,
        }).select('orderId amount createdAt').lean(),
      ]);

      const expectedReceivablePaise = toPaise(awaiting[0]?.total || 0);
      const expectedCashPaise = toPaise(collectedUnbanked[0]?.total || 0);

      // Resolve the stranded set: only orders that really are CANCELLED count.
      let strandedSamples = [];
      let strandedPaise = 0;
      if (stranded.length) {
        const orderIds = stranded.map((p) => p.orderId).filter(Boolean);
        const cancelled = await Order.find({
          _id: { $in: orderIds }, status: ORDER_STATUS.CANCELLED,
        }).select('_id').lean();
        const cancelledIds = new Set(cancelled.map((o) => String(o._id)));
        const bad = stranded.filter((p) => cancelledIds.has(String(p.orderId)));
        strandedPaise = sumPaise(...bad.map((p) => toPaise(p.amount || 0)));
        strandedSamples = bad.slice(0, 10).map((p) => ({
          paymentId: String(p._id),
          orderId: String(p.orderId),
          amountPaise: toPaise(p.amount || 0),
          ageHours: Math.round(((Date.now() - new Date(p.createdAt).getTime()) / 3600000) * 100) / 100,
        }));
      }

      const receivableDiff = receivableAcct.balancePaise - expectedReceivablePaise;
      const cashDiff = cashAcct.balancePaise - expectedCashPaise;
      // A whole rupee of slack across the entire cash book, matching the
      // tolerance the other ledger reconciliations use.
      const tolerance = 100;

      return {
        checked: true,
        outstandingCount: awaiting[0]?.n || 0,
        receivablePaise: expectedReceivablePaise,
        receivableAccountPaise: receivableAcct.balancePaise,
        receivableDifferencePaise: receivableDiff,
        collectedNotBankedCount: collectedUnbanked[0]?.n || 0,
        cashOnHandPaise: expectedCashPaise,
        cashOnHandAccountPaise: cashAcct.balancePaise,
        cashOnHandDifferencePaise: cashDiff,
        strandedReceivables: strandedSamples.length,
        strandedPaise,
        samples: strandedSamples,
        tolerancePaise: tolerance,
        ok: Math.abs(receivableDiff) <= tolerance
          && Math.abs(cashDiff) <= tolerance
          && strandedSamples.length === 0,
      };
    } catch (e) {
      return { error: e?.message || String(e), ok: false };
    }
  }

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
