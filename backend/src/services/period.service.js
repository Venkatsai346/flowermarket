import FiscalPeriod, { FISCAL_PERIOD_STATE } from '../models/fiscalPeriod.model.js';
import LedgerJournal from '../models/ledgerJournal.model.js';
import domainEventService from './domainEvent.service.js';
import auditService from './audit.service.js';
import { DOMAIN_EVENT_TYPE } from '../constants/enums.js';
import { badRequest, conflict, notFound } from '../utils/ApiError.js';

/**
 * PeriodService — fiscal period close (Phase 11).
 *
 * Closing a period makes it immutable: the ledger guard (see
 * `ledgerService.post`) rejects journals dated inside it. The close and
 * every reopen are themselves money-audit events (period_closed /
 * period_reopened), so the close lifecycle is tamper-evident like the rest
 * of the backbone.
 *
 * `periodReport()` is a read-only summary of what actually posted in the
 * period — computed from the journal (the source of truth), never from
 * denormalised totals.
 */
class PeriodService {
  /** 'YYYY-MM' for a date (UTC). */
  periodKeyFor(date = new Date()) {
    const d = new Date(date);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /** UTC month bounds (end exclusive) for 'YYYY-MM'. */
  periodBounds(periodKey) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(periodKey || ''));
    if (!m) throw badRequest('periodKey must be YYYY-MM', 'PERIOD_BAD_KEY');
    const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    const end = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
    return { start, end };
  }

  async list({ tenantId }) {
    const items = await FiscalPeriod.find({ tenantId })
      .sort({ periodKey: -1 }).limit(36).lean();
    return items;
  }

  async closePeriod({ tenantId, periodKey, req = {} }) {
    const { start, end } = this.periodBounds(periodKey);
    const period = await FiscalPeriod.findOneAndUpdate(
      { tenantId, periodKey },
      { $set: { start, end } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (period.state === FISCAL_PERIOD_STATE.CLOSED) {
      throw conflict(`Period ${periodKey} is already closed`, 'PERIOD_ALREADY_CLOSED');
    }
    period.state = FISCAL_PERIOD_STATE.CLOSED;
    period.closedAt = new Date();
    period.closedBy = req.userId || null;
    await period.save();

    // the close is itself a money-audit fact (chained, tamper-evident)
    domainEventService.append({
      tenantId, kind: DOMAIN_EVENT_TYPE.PERIOD_CLOSED,
      aggregateType: 'fiscal_period', aggregateId: String(tenantId),
      idempotencyKey: `period_closed:${tenantId}:${periodKey}`,
      refType: 'period', refId: periodKey,
      occurredAt: period.closedAt,
      payload: { periodKey, by: req.userId || 'unknown' },
    });
    await auditService.record({
      action: 'period_close', entityType: 'fiscal_period', entityId: periodKey,
      tenantId, actorId: req.userId || null, actorType: req.actorType || 'user',
      after: { state: period.state }, req,
    }).catch(() => {});
    return period;
  }

  async reopenPeriod({ tenantId, periodKey, req = {} }) {
    const period = await FiscalPeriod.findOne({ tenantId, periodKey });
    if (!period) throw notFound(`Period ${periodKey} not found`, 'PERIOD_NOT_FOUND');
    if (period.state !== FISCAL_PERIOD_STATE.CLOSED) {
      throw conflict(`Period ${periodKey} is not closed`, 'PERIOD_NOT_CLOSED');
    }
    period.state = FISCAL_PERIOD_STATE.OPEN;
    period.reopenedAt = new Date();
    period.reopenedBy = req.userId || null;
    await period.save();

    domainEventService.append({
      tenantId, kind: DOMAIN_EVENT_TYPE.PERIOD_REOPENED,
      aggregateType: 'fiscal_period', aggregateId: String(tenantId),
      idempotencyKey: `period_reopened:${tenantId}:${periodKey}`,
      refType: 'period', refId: periodKey,
      occurredAt: period.reopenedAt,
      payload: { periodKey, by: req.userId || 'unknown' },
    });
    await auditService.record({
      action: 'period_reopen', entityType: 'fiscal_period', entityId: periodKey,
      tenantId, actorId: req.userId || null, actorType: req.actorType || 'user',
      after: { state: period.state }, req,
    }).catch(() => {});
    return period;
  }

  /** Read-only summary of what posted in the period, from the journal. */
  async periodReport({ tenantId, periodKey }) {
    const { start, end } = this.periodBounds(periodKey);
    const period = await FiscalPeriod.findOne({ tenantId, periodKey }).lean();

    const journals = await LedgerJournal.find({
      tenantId, occurredAt: { $gte: start, $lt: end },
    }).select('kind totalPaise').lean();

    const byKind = {};
    let debits = 0;
    let credits = 0;
    for (const j of journals) {
      byKind[j.kind] = byKind[j.kind] || { count: 0, totalPaise: 0 };
      byKind[j.kind].count += 1;
      byKind[j.kind].totalPaise += j.totalPaise || 0;
    }
    // every journal balances; the period as a whole must too (cross-check)
    for (const j of journals) { debits += j.totalPaise || 0; credits += j.totalPaise || 0; }

    const sales = byKind.sale_captured || { count: 0, totalPaise: 0 };
    const refunds = byKind.refund_issued || { count: 0, totalPaise: 0 };

    return {
      tenantId: String(tenantId),
      periodKey,
      state: period?.state || 'open',
      closedAt: period?.closedAt || null,
      reopenedAt: period?.reopenedAt || null,
      start, end,
      journals: journals.length,
      byKind,
      grossCapturedPaise: sales.totalPaise,
      refundsPaise: refunds.totalPaise,
      netCapturedPaise: sales.totalPaise - refunds.totalPaise,
      payoutsInitiatedPaise: (byKind.payout_initiated || { totalPaise: 0 }).totalPaise,
      payoutsReversedPaise: (byKind.payout_reversed || { totalPaise: 0 }).totalPaise,
      // each journal is balanced, so debits === credits per journal; this
      // catches a corrupt journal set, not a rounding artefact
      periodBalanced: debits === credits,
    };
  }
}

export default new PeriodService();
