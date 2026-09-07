import crypto from 'node:crypto';
import DomainEvent from '../models/domainEvent.model.js';
import AuditChain from '../models/auditChain.model.js';
import Order from '../models/order.model.js';
import RefundTransaction from '../models/refundTransaction.model.js';
import PayoutBatch from '../models/payoutBatch.model.js';
import LedgerJournal from '../models/ledgerJournal.model.js';
import { DOMAIN_EVENT_TYPE, DOMAIN_EVENT_JOURNAL_KINDS, LEDGER_JOURNAL_KIND, ORDER_STATUS, REFUND_TRANSACTION_STATUS } from '../constants/enums.js';

// the chain starts from a fixed genesis (no prevHash before the first event)
const GENESIS_HASH = '0'.repeat(64);
const CAS_ATTEMPTS = 5;

/** Sort-object-keys JSON — the hash must not depend on key order. */
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}

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
   * Append a domain event exactly once, chained into the tenant's audit
   * chain (Phase 11). `idempotencyKey` must be stable for the fact (for
   * journal-carrying kinds it is the journal's idempotencyKey).
   *
   * Chain protocol (per tenant, anchored in `auditchains`):
   *   1. duplicate pre-check — known keys never touch the chain;
   *   2. compare-and-set reservation: read the anchor tail, propose
   *      `seq = tailSeq + 1`, `prevHash = tailHash`, compute `hash` over the
   *      canonical content, then conditionally advance the anchor — so two
   *      processes (API + worker) can append concurrently without forking;
   *   3. insert the event with its seq/prevHash/hash;
   *   4. on a lost duplicate race, roll the anchor back (no gaps).
   *
   * Never throws. If the CAS is lost 5× (pathological contention) or the
   * insert fails, the row is inserted UNANCHORED (seq null) — the chain
   * check reports it and `repairChain()` folds it in. The money path is
   * never gated by the audit layer.
   * @returns {Promise<{created:boolean, duplicate?:boolean, event?:object}>}
   */
  async append({
    tenantId = null, traceId = null, kind, aggregateType, aggregateId,
    idempotencyKey = null, payload = null, occurredAt = null,
    refType = null, refId = null, schemaVersion = 1,
  }) {
    let reserved = null;
    try {
      if (idempotencyKey) {
        const existing = await DomainEvent.findOne({ idempotencyKey }).lean();
        if (existing) return { created: false, duplicate: true, event: existing };
      }
      const doc = {
        tenantId, traceId, kind, schemaVersion,
        aggregateType, aggregateId: String(aggregateId),
        refType, refId: refId ? String(refId) : null,
        idempotencyKey, payload, occurredAt: occurredAt ? new Date(occurredAt) : null,
      };

      if (tenantId) reserved = await this._reserveChainSlot(String(tenantId), doc);
      if (reserved) { doc.seq = reserved.seq; doc.prevHash = reserved.prevHash; doc.hash = reserved.hash; }

      const event = await DomainEvent.create(doc);
      return { created: true, event };
    } catch (err) {
      if (err?.code === 11000 && reserved) {
        // lost the race on the unique key — roll the anchor back (CAS on the
        // exact state we proposed) so the chain has no gap
        await AuditChain.findOneAndUpdate(
          { tenantId, seq: reserved.seq, tailHash: reserved.hash, tailSeq: reserved.seq },
          { $set: { seq: reserved.prevSeq, tailHash: reserved.prevTailHash, tailSeq: reserved.prevSeq } }
        ).catch(() => {});
      }
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

  // -------------------------------------------------------------------------
  // Phase 11 — hash chain (tamper-evidence)
  // -------------------------------------------------------------------------

  /** SHA-256 over the canonical content of one chain event. */
  _eventHash({ tenantId, seq, prevHash, doc }) {
    const content = [
      String(tenantId), String(seq), doc.kind, doc.aggregateType, doc.aggregateId,
      doc.refType || '', doc.refId || '', doc.idempotencyKey || '',
      doc.occurredAt ? new Date(doc.occurredAt).toISOString() : '',
      doc.traceId || '', canonicalJson(doc.payload === undefined ? null : doc.payload),
    ].join('|');
    return crypto.createHash('sha256').update(`${prevHash}|${content}`, 'utf8').digest('hex');
  }

  /**
   * CAS-reserve the next slot of the tenant chain. Returns
   * `{seq, prevHash, hash, prevSeq, prevTailHash}` or null when the CAS is
   * lost `CAS_ATTEMPTS` times in a row (caller inserts unanchored).
   */
  async _reserveChainSlot(tenantId, doc) {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const anchor = await AuditChain.findOne({ tenantId }).lean();
      const prevSeq = anchor ? anchor.tailSeq : 0;
      const prevTailHash = anchor ? anchor.tailHash : GENESIS_HASH;
      const seq = prevSeq + 1;
      const hash = this._eventHash({ tenantId, seq, prevHash: prevTailHash, doc });
      const update = { $set: { seq, tailHash: hash, tailSeq: seq } };
      try {
        const saved = anchor
          ? await AuditChain.findOneAndUpdate({ tenantId, tailSeq: prevSeq }, update, { new: true }).lean()
          : await AuditChain.findOneAndUpdate({ tenantId }, update, { upsert: true, new: true }).lean();
        if (saved) {
          return { seq, prevHash: prevTailHash, hash, prevSeq, prevTailHash };
        }
      } catch (e) {
        if (e?.code !== 11000) throw e; // upsert race — retry as normal
      }
      // the tail moved under us — retry against the new tail
    }
    return null;
  }

  /**
   * Verify one tenant's chain. Re-hashes every stored event, walks the
   * links, and checks the tail against the anchor. Break taxonomy:
   *   hash_mismatch  — stored content no longer matches its hash (edited)
   *   broken_front   — first stored event points at a deleted predecessor
   *   broken_link    — event N+1's prevHash ≠ event N's hash (deleted/moved)
   *   tail_mismatch  — anchor and stored tail disagree (tail edited/rewritten)
   *   tail_missing   — anchor points at a seq with no stored event
   * @returns {Promise<{tenantId, eventsVerified, unanchored, breaks:[]}>}
   */
  async verifyChain(tenantId) {
    const [anchor, events, unanchored] = await Promise.all([
      AuditChain.findOne({ tenantId }).lean(),
      DomainEvent.find({ tenantId, seq: { $ne: null } }).sort({ seq: 1 }).lean(),
      DomainEvent.countDocuments({ tenantId, seq: null }),
    ]);
    const breaks = [];
    let prev = null;
    for (const e of events) {
      const recomputed = this._eventHash({ tenantId, seq: e.seq, prevHash: e.prevHash, doc: e });
      if (recomputed !== e.hash) {
        breaks.push({ seq: e.seq, type: 'hash_mismatch', idempotencyKey: e.idempotencyKey });
      }
      if (!prev && e.prevHash !== GENESIS_HASH) {
        breaks.push({ seq: e.seq, type: 'broken_front', idempotencyKey: e.idempotencyKey });
      }
      if (prev && e.prevHash !== prev.hash) {
        breaks.push({ seq: e.seq, type: 'broken_link', idempotencyKey: e.idempotencyKey });
      }
      prev = e;
    }
    const storedTail = events[events.length - 1] || null;
    if (anchor && anchor.tailSeq > 0 && !storedTail) {
      breaks.push({ seq: anchor.tailSeq, type: 'tail_missing' });
    } else if (anchor && storedTail && (storedTail.seq !== anchor.tailSeq || storedTail.hash !== anchor.tailHash)) {
      breaks.push({ seq: storedTail?.seq, type: 'tail_mismatch', idempotencyKey: storedTail?.idempotencyKey });
    }
    return { tenantId: String(tenantId), eventsVerified: events.length, unanchored, breaks };
  }

  /** Verify every tenant with events (platform scope of the integrity report). */
  async verifyChains({ tenantId = null } = {}) {
    if (tenantId) {
      const one = await this.verifyChain(String(tenantId));
      return { tenants: 1, eventsVerified: one.eventsVerified, unanchored: one.unanchored, breaks: one.breaks, ok: one.breaks.length === 0 };
    }
    const tenantIds = await DomainEvent.distinct('tenantId');
    const ids = tenantIds.filter(Boolean);
    const out = { tenants: ids.length, eventsVerified: 0, unanchored: 0, breaks: [] };
    for (const t of ids) {
      const one = await this.verifyChain(String(t));
      out.eventsVerified += one.eventsVerified;
      out.unanchored += one.unanchored;
      out.breaks.push(...one.breaks.map((b) => ({ ...b, tenantId: one.tenantId })));
    }
    out.ok = out.breaks.length === 0;
    return out;
  }

  /**
   * Re-link the tenant chain: re-hash every stored event in seq order
   * (genesis → tail) and reset the anchor to the new tail.
   *
   * Use this ONLY after a legitimate row-set change — e.g. an event was
   * deleted and later restored from its journal (the replay's orphan path),
   * leaving a broken link where the row used to be. Rebuilding is a DELIBERATE
   * operator act (it changes every hash, so it is recorded as a
   * `chain_rebuilt` audit event), which is exactly what separates it from
   * tampering: a tamper that is never rebuilt stays visible as a break.
   * The nightly job never calls this.
   * @returns {Promise<{relinked, tailHash}>}
   */
  async rebuildChain({ tenantId = null, limit = 100000 } = {}) {
    const events = await DomainEvent.find({
      ...(tenantId ? { tenantId } : {}), seq: { $ne: null },
    }).sort({ seq: 1 }).limit(limit).lean();
    let prevHash = GENESIS_HASH;
    for (const e of events) {
      const hash = this._eventHash({ tenantId: e.tenantId, seq: e.seq, prevHash, doc: e });
      await DomainEvent.updateOne({ _id: e._id }, { $set: { prevHash, hash } });
      prevHash = hash;
    }
    if (tenantId) {
      const t = String(tenantId);
      const tail = events.filter((e) => String(e.tenantId) === t).slice(-1)[0] || null;
      await AuditChain.findOneAndUpdate(
        { tenantId: t },
        { $set: { seq: tail ? tail.seq : 0, tailHash: tail ? prevHash : GENESIS_HASH, tailSeq: tail ? tail.seq : 0 } },
        { upsert: true }
      );
      // the rebuild itself is a fact in the chain (never-throwing append)
      await this.append({
        tenantId, kind: DOMAIN_EVENT_TYPE.CHAIN_REBUILT,
        aggregateType: 'audit_chain', aggregateId: t,
        idempotencyKey: `chain_rebuilt:${tenantId}:${Date.now()}`,
        occurredAt: new Date(),
        payload: { relinked: events.length, tailHash: prevHash },
      });
      return { relinked: events.length, tailHash: prevHash };
    }
    // platform scope: rebuild each tenant
    const tenantIds = await DomainEvent.distinct('tenantId');
    let total = 0;
    for (const t of tenantIds.filter(Boolean)) {
      const out = await this.rebuildChain({ tenantId: String(t), limit });
      total += out.relinked;
    }
    return { relinked: total, tailHash: null };
  }

  /**
   * Fold UNANCHORED stored events (seq null — failed appends, or restored
   * rows) into the tenant chain, in (occurredAt, createdAt, _id) order.
   * Idempotent; anchored events are never touched.
   * @returns {Promise<{anchored, failed:[]}>}
   */
  async repairChain({ tenantId = null, limit = 500 } = {}) {
    const q = { seq: null, ...(tenantId ? { tenantId } : {}) };
    const pending = await DomainEvent.find(q)
      .sort({ occurredAt: 1, createdAt: 1, _id: 1 }).limit(limit).lean();
    const out = { anchored: 0, failed: [] };
    for (const e of pending) {
      const t = e.tenantId ? String(e.tenantId) : null;
      if (!t) { out.failed.push({ idempotencyKey: e.idempotencyKey, reason: 'no tenant — cannot chain' }); continue; }
      try {
        const doc = {
          kind: e.kind, aggregateType: e.aggregateType, aggregateId: e.aggregateId,
          refType: e.refType, refId: e.refId, idempotencyKey: e.idempotencyKey,
          payload: e.payload, occurredAt: e.occurredAt, traceId: e.traceId,
        };
        const reserved = await this._reserveChainSlot(t, doc);
        if (!reserved) throw new Error('chain CAS contention');
        await DomainEvent.updateOne(
          { _id: e._id, seq: null },
          { $set: { seq: reserved.seq, prevHash: reserved.prevHash, hash: reserved.hash } }
        );
        out.anchored += 1;
      } catch (err) {
        out.failed.push({ idempotencyKey: e.idempotencyKey, reason: err?.message || String(err) });
      }
    }
    return out;
  }

  /** All events for one trace (the "follow the money" chain), oldest first. */
  /** Look up an event by its idempotency key (journal-chain checks, replay). */
  findEventByKey(idempotencyKey) {
    if (!idempotencyKey) return Promise.resolve(null);
    return DomainEvent.findOne({ idempotencyKey }).lean();
  }

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
      LEDGER_JOURNAL_KIND.PSP_SETTLED,
      LEDGER_JOURNAL_KIND.STATUTORY_DEPOSIT,
      LEDGER_JOURNAL_KIND.STATUTORY_DEPOSIT_REVERTED,
      LEDGER_JOURNAL_KIND.WALLET_TOPUP,
      LEDGER_JOURNAL_KIND.WALLET_BACKFILL,
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
      case DOMAIN_EVENT_TYPE.WALLET_TOPUP: {
        // the WalletTransaction is the aggregate of record — re-derive the
        // counter from its reason (top-up → gateway clearing, goodwill →
        // goodwill expense)
        const { default: WalletTransaction } = await import('../models/walletTransaction.model.js');
        const { WALLET_TXN_REASON } = await import('../constants/enums.js');
        const txn = await WalletTransaction.findById(id).lean();
        if (!txn) throw Object.assign(new Error('wallet transaction missing'), { code: 'AGGREGATE_MISSING' });
        await ledgerPostingService.postWalletTopup({ walletTransaction: txn, goodwill: txn.reason === WALLET_TXN_REASON.GOODWILL });
        return;
      }
      case DOMAIN_EVENT_TYPE.WALLET_BACKFILL:
        // the reconciled difference is historical data — it cannot be
        // re-derived after the fact, so replay REFUSES it loudly instead of
        // guessing an amount
        throw Object.assign(new Error('wallet backfill journal not re-derivable — restore manually'), { code: 'WALLET_BACKFILL_NOT_REPLAYABLE' });
      case DOMAIN_EVENT_TYPE.STATUTORY_DEPOSIT:
      case DOMAIN_EVENT_TYPE.STATUTORY_DEPOSIT_REVERTED: {
        // the StatutoryDeposit doc is the aggregate of record (findDrift does
        // not project payloads) — re-post the identical move between
        // {statute}_payable and bank (idempotent on the key)
        const ledgerMod = await import('./ledger.service.js');
        const { default: StatutoryDeposit } = await import('../models/statutoryDeposit.model.js');
        const ledgerSvc = ledgerMod.default;
        const { ledgerAccounts } = ledgerMod;
        const deposit = await StatutoryDeposit.findById(id).lean();
        if (!deposit) throw Object.assign(new Error('statutory deposit missing'), { code: 'AGGREGATE_MISSING' });
        const account = deposit.statute === 'tds' ? ledgerAccounts.tdsPayable() : ledgerAccounts.tcsPayable();
        const isRevert = e.kind === DOMAIN_EVENT_TYPE.STATUTORY_DEPOSIT_REVERTED;
        await ledgerSvc.post({
          kind: isRevert ? LEDGER_JOURNAL_KIND.STATUTORY_DEPOSIT_REVERTED : LEDGER_JOURNAL_KIND.STATUTORY_DEPOSIT,
          idempotencyKey: e.idempotencyKey,
          lines: isRevert
            ? [
              { accountCode: ledgerAccounts.bank(), debitPaise: deposit.amountPaise },
              { accountCode: account, creditPaise: deposit.amountPaise },
            ]
            : [
              { accountCode: account, debitPaise: deposit.amountPaise },
              { accountCode: ledgerAccounts.bank(), creditPaise: deposit.amountPaise },
            ],
          refType: 'statutory_deposit',
          refId: id,
          tenantId: e.tenantId || null,
          occurredAt: e.occurredAt,
          meta: {
            statute: deposit.statute,
            utr: deposit.utr || null,
            ...(isRevert ? { reason: deposit.revertReason || 'replay' } : { reference: deposit.reference || null }),
            source: 'replay',
          },
          traceId: e.traceId || null,
        });
        return;
      }
      case DOMAIN_EVENT_TYPE.PSP_SETTLED: {
        // the event payload carries the exact settlement amount — re-post the
        // identical clearing→bank move (idempotent on the same key)
        const order = await Order.findById(id);
        if (!order) throw Object.assign(new Error('order missing'), { code: 'ORDER_MISSING' });
        const ledgerMod = await import('./ledger.service.js');
        const ledgerService = ledgerMod.default;
        const { ledgerAccounts } = ledgerMod;
        const amountPaise = e.payload?.amountPaise ?? Math.round(Number(order.totalAmount) * 100);
        await ledgerService.post({
          kind: LEDGER_JOURNAL_KIND.PSP_SETTLED,
          idempotencyKey: e.idempotencyKey,
          lines: [
            { accountCode: ledgerAccounts.bank(), debitPaise: amountPaise },
            { accountCode: ledgerAccounts.gatewayClearing(), creditPaise: amountPaise },
          ],
          refType: 'order',
          refId: order._id,
          tenantId: order.tenantId,
          occurredAt: e.occurredAt,
          meta: { orderNumber: order.orderNumber, utr: e.payload?.utr || null, reference: e.payload?.reference || null, source: 'replay' },
          traceId: e.traceId || null,
        });
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
      [LEDGER_JOURNAL_KIND.PSP_SETTLED]: {
        kind: DOMAIN_EVENT_TYPE.PSP_SETTLED, aggregateType: 'order', aggregateId: j.refId,
        occurredAt: j.occurredAt,
        payload: { orderNumber: j.meta?.orderNumber, amountPaise: j.totalPaise, utr: j.meta?.utr || null, reference: j.meta?.reference || null, source: 'restored_from_journal' },
      },
      [LEDGER_JOURNAL_KIND.STATUTORY_DEPOSIT]: {
        kind: DOMAIN_EVENT_TYPE.STATUTORY_DEPOSIT, aggregateType: 'statutory_deposit', aggregateId: j.refId,
        occurredAt: j.occurredAt,
        payload: { statute: j.meta?.statute, amountPaise: j.totalPaise, utr: j.meta?.utr || null, reference: j.meta?.reference || null, accountCode: j.meta?.statute === 'tds' ? 'tds_payable' : 'tcs_payable', source: 'restored_from_journal' },
      },
      [LEDGER_JOURNAL_KIND.STATUTORY_DEPOSIT_REVERTED]: {
        kind: DOMAIN_EVENT_TYPE.STATUTORY_DEPOSIT_REVERTED, aggregateType: 'statutory_deposit', aggregateId: j.refId,
        occurredAt: j.occurredAt,
        payload: { statute: j.meta?.statute, amountPaise: j.totalPaise, utr: j.meta?.originalUtr || null, reason: j.meta?.reason || null, accountCode: j.meta?.statute === 'tds' ? 'tds_payable' : 'tcs_payable', source: 'restored_from_journal' },
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
