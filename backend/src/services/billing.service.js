/**
 * BillingService — subscriptions, invoices, billing cycle (Phase 5).
 *
 * - One live subscription per tenant (partial unique index).
 * - Invoices unique per (tenant, period.from, period.to) → the billing cycle
 *   is idempotent; re-running a period never duplicates (the unique index is
 *   the backstop — generateInvoice() treats a duplicate-key race as
 *   "someone else just created it" and returns the existing row).
 * - Plan change mid-period writes a pro-rata pendingAdjustment applied to the
 *   next invoice (then cleared). Pricing is snapshotted — history never mutates.
 * - Commission-rate changes are EFFECTIVE NEXT PERIOD (pendingCommissionRateBps,
 *   applied on period advance): the current period always bills at the rate in
 *   force when its sales happened. Only the fee difference is pro-rated now.
 * - Invoice totals are SIGNED-correct: total = fee + commission + adjustment
 *   (adjustment may be a credit) + GST on the taxable value.
 * - Standing (trial/active/past_due) has ONE choke point: refreshStanding().
 *   Paying clears past_due only when ZERO delinquent invoices remain; voiding
 *   re-evaluates the same way. The overdue sweep additionally self-heals any
 *   drift (an OVERDUE invoice whose subscription is not past_due).
 * - Payments go through billingProvider (mock default). Zero-value invoices
 *   never touch the gateway — they auto-finalise as paid at generation.
 */

import TenantSubscription from '../models/tenantSubscription.model.js';
import Invoice from '../models/invoice.model.js';
import AnalyticsDaily from '../models/analyticsDaily.model.js';
import Order from '../models/order.model.js';
import Tenant from '../models/tenant.model.js';
import planService from './plan.service.js';
import billingProvider from './billingProvider.service.js';
import auditService from './audit.service.js';
import { serializeList } from '../utils/serialize.js';
import { notFound, badRequest, conflict, internal } from '../utils/ApiError.js';
import { roundMoney, moneySum } from '../utils/money.js';
import { generateOpaqueToken } from '../utils/hash.js';
import config from '../config/index.js';
import {
  TENANT_SUBSCRIPTION_STATUS,
  INVOICE_STATUS,
  INVOICE_LINE_TYPE,
} from '../constants/enums.js';

const MONTH_MS = 30 * 24 * 3600 * 1000;

function addMonths(d, n = 1) {
  const nd = new Date(d);
  nd.setUTCMonth(nd.getUTCMonth() + n);
  return nd;
}

/** Live-subscription statuses — the only rows the cycle, sweep and guard read. */
export const LIVE_SUB_STATUSES = Object.freeze([
  TENANT_SUBSCRIPTION_STATUS.TRIAL,
  TENANT_SUBSCRIPTION_STATUS.ACTIVE,
  TENANT_SUBSCRIPTION_STATUS.PAST_DUE,
]);

/**
 * Is this invoice delinquent RIGHT NOW? PURE: plain object + date in, boolean out.
 *
 * Delinquent = OVERDUE, or OPEN with its due date reached. An OPEN invoice whose
 * due date is still in the future is a scheduled payment, not a debt — dunning
 * must never fire on it. PAID/VOID/DRAFT are never delinquent.
 * `scripts/billing-calc.test.js` locks every branch without a database.
 */
export function isInvoiceDelinquent(invoice, now = new Date()) {
  if (!invoice) return false;
  if (invoice.status === INVOICE_STATUS.OVERDUE) return true;
  if (invoice.status !== INVOICE_STATUS.OPEN) return false;
  if (!invoice.dueAt) return false;
  return new Date(invoice.dueAt).getTime() <= new Date(now).getTime();
}

/**
 * Standing transition for a delinquency count. PURE.
 *
 * - debt appears (count > 0) on a trial/active subscription → past_due.
 * - debt fully clears (count == 0) on a past_due subscription → active.
 * - everything else (incl. cancelled) is untouched: cancelling with debt does
 *   NOT forgive the debt, and paying can never resurrect a cancelled row.
 */
export function standingFor({ currentStatus, delinquentCount }) {
  if (delinquentCount > 0) {
    if (currentStatus === TENANT_SUBSCRIPTION_STATUS.TRIAL || currentStatus === TENANT_SUBSCRIPTION_STATUS.ACTIVE) {
      return TENANT_SUBSCRIPTION_STATUS.PAST_DUE;
    }
    return currentStatus;
  }
  if (currentStatus === TENANT_SUBSCRIPTION_STATUS.PAST_DUE) return TENANT_SUBSCRIPTION_STATUS.ACTIVE;
  return currentStatus;
}

/**
 * Invoice totals from signed components. PURE.
 *
 * The adjustment is SIGNED (a downgrade pro-rata is a credit): the taxable
 * value is fee + commission + adjustment, floored at zero, and GST applies to
 * that taxable value. Total = taxable + GST. Every figure is rounded to paise
 * at the boundary so the journaliser never sees float dust.
 */
export function computeInvoiceTotals({ fee = 0, commission = 0, adjustmentSigned = 0, gstBps = 0 } = {}) {
  const taxable = roundMoney(Math.max(0, (Number(fee) || 0) + (Number(commission) || 0) + (Number(adjustmentSigned) || 0)));
  const gst = roundMoney((taxable * (Number(gstBps) || 0)) / 10000);
  return { taxable, gst, total: roundMoney(taxable + gst) };
}

/**
 * Schema-shape probe for the tenant-billing model. Returns every sub-check
 * (not just the verdict) so a failure is instantly diagnosable from the
 * error details alone — a guard that convicts on hidden evidence is worse
 * than no guard.
 *
 * PROBE RULE (Mongoose): single-nested subdocuments are NOT in `schema.paths`
 * (probing an intermediate returns undefined even on the correct schema —
 * intermediates live in `schema.nested`). Presence of a nested block MUST be
 * probed through its LEAF paths. This exact mistake false-positived on every
 * registration once; the unit suite locks the semantics.
 */
export function checkTenantBillingShape(schema) {
  const statusValues = schema?.path('status')?.enumValues || [];
  const checks = {
    schemaRegistered: Boolean(schema),
    hasPlanCode: Boolean(schema?.path('planCode')),
    hasTenantId: Boolean(schema?.path('tenantId')),
    hasPlanSnapshot: Boolean(schema?.path('planSnapshot.name')) && Boolean(schema?.path('planSnapshot.priceMonthly')),
    statusIsEnum: Array.isArray(statusValues) && statusValues.length > 0,
    statusHasTrial: statusValues.includes(TENANT_SUBSCRIPTION_STATUS.TRIAL),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

/**
 * Schema-identity guard. Tenant billing writes go to the TenantSubscription
 * model — never to Subscription, which is the CUSTOMER recurring-order schema
 * (userId/frequency/nextDeliveryAt). A past incident wrote billing rows through
 * the bare `Subscription` name and failed cryptically AFTER the tenant existed;
 * the vocabulary split makes that unrepresentable, and this guard fails LOUD
 * (500, before any write, with every sub-check attached) if the wiring ever
 * regresses.
 */
export function assertTenantSubscriptionSchema() {
  const { ok, checks } = checkTenantBillingShape(TenantSubscription?.schema);
  if (!ok) {
    throw internal(
      'TenantSubscription schema mismatch: the registered \'TenantSubscription\' model is not the tenant-billing schema — see details for the exact failing check(s). Refusing to write billing state against the wrong schema.',
      'BILLING_SCHEMA_MISMATCH',
      {
        ...checks,
        statusEnum: TenantSubscription?.schema?.path('status')?.enumValues || [],
        expectedTrial: TENANT_SUBSCRIPTION_STATUS.TRIAL,
        modelName: TenantSubscription?.modelName || null,
        collection: TenantSubscription?.collection?.name || null,
      }
    );
  }
}

/** Atomic per-platform invoice number: INV-{YYMM}-{seq}. */
async function nextInvoiceNumber() {
  const { default: Counter } = await import('../models/counter.model.js');
  const doc = await Counter.findOneAndUpdate(
    { key: `invoice:${new Date().toISOString().slice(2, 7)}` }, // INV-2609
    { $inc: { value: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return `INV-${new Date().toISOString().slice(2, 7)}-${String(doc.value).padStart(4, '0')}`;
}

class BillingService {
  // ---------------- subscriptions ----------------
  async ensureSubscription({ tenantId, planCode, commissionRateBps = null, trialDays = 0, actorId = null, session = null }) {
    assertTenantSubscriptionSchema();
    const plan = await planService.getByCode(planCode);
    const lookup = TenantSubscription.findOne({ tenantId, status: { $in: LIVE_SUB_STATUSES } });
    if (session) lookup.session(session);
    const existing = await lookup;
    if (existing) return { subscription: existing, created: false };

    const now = new Date();
    const periodEnd = addMonths(now, 1);
    // `new + save` (not create-with-options): Model.create(doc, opts) has a
    // notorious doc-vs-options ambiguity for the single-doc form, while
    // save(options) is unambiguous — and identical otherwise.
    const subscription = new TenantSubscription({
      tenantId,
      planCode: plan.code,
      planSnapshot: { name: plan.name, priceMonthly: plan.priceMonthly },
      commissionRateBps: commissionRateBps ?? plan.commissionRateBps,
      currency: plan.currency || 'INR',
      status: trialDays > 0 ? TENANT_SUBSCRIPTION_STATUS.TRIAL : TENANT_SUBSCRIPTION_STATUS.ACTIVE,
      periodStart: now,
      periodEnd,
      trialEndsAt: trialDays > 0 ? new Date(now.getTime() + trialDays * 86400000) : null,
      cancelAtPeriodEnd: false,
      pendingAdjustment: { amount: 0, label: null },
      changedAt: now,
    });
    await subscription.save(session ? { session } : undefined);
    return { subscription, created: true };
  }

  async currentSubscription({ tenantId }) {
    return TenantSubscription.findOne({ tenantId, status: { $in: LIVE_SUB_STATUSES } }).lean();
  }

  async subscriptionsForTenants(tenantIds) {
    if (!tenantIds.length) return [];
    return TenantSubscription.find({ tenantId: { $in: tenantIds }, status: { $in: LIVE_SUB_STATUSES } }).lean();
  }

  /** Plan change: snapshot updates now, price difference applies from next period. */
  async changePlan({ tenantId, planCode, actorId = null, req = null }) {
    const plan = await planService.getActiveByCode(planCode);
    let sub = await TenantSubscription.findOne({ tenantId, status: { $in: LIVE_SUB_STATUSES } });
    if (!sub) {
      // existing store joining the marketplace: create its first subscription
      const res = await this.ensureSubscription({
        tenantId, planCode, commissionRateBps: plan.commissionRateBps, trialDays: plan.trialDays,
      });
      sub = res.subscription;
      if (res.created) {
        await Tenant.updateOne({ _id: tenantId }, {
          $set: {
            plan: plan.code,
            'features.marketplaceEnabled': Boolean(plan.features?.marketplaceEnabled),
            'features.subscriptionsEnabled': Boolean(plan.features?.marketplaceEnabled),
          },
        });
        await auditService.record({
          action: 'subscribe', entityType: 'subscription', entityId: sub._id,
          tenantId, actorId, actorType: 'admin',
          after: { planCode: plan.code, priceMonthly: plan.priceMonthly }, req,
        }).catch(() => {});
        return { subscription: sub, changed: true, created: true };
      }
    }

    const before = { planCode: sub.planCode, priceMonthly: sub.planSnapshot.priceMonthly };
    if (sub.planCode === plan.code) return { subscription: sub, changed: false };

    const oldPrice = sub.planSnapshot.priceMonthly;
    const now = Date.now();
    const totalMs = Math.max(1, sub.periodEnd.getTime() - sub.periodStart.getTime());
    const remainingMs = Math.max(0, sub.periodEnd.getTime() - now);
    const prorated = roundMoney(((plan.priceMonthly - oldPrice) * remainingMs) / totalMs);

    sub.planCode = plan.code;
    sub.planSnapshot = { name: plan.name, priceMonthly: plan.priceMonthly };
    // Rate effective-dating: the CURRENT period keeps billing at the rate in
    // force when its sales happened. Rewriting commissionRateBps here would
    // retroactively re-price the whole period's GMV (upgrade on day 29 to halve
    // the month's commission, or a downgrade that doubles it). The new rate
    // waits in pendingCommissionRateBps and the cycle applies it when the
    // period advances; last change in a period wins. Only the fee difference
    // is pro-rated immediately, via pendingAdjustment.
    if ((plan.commissionRateBps ?? null) !== (sub.commissionRateBps ?? null)) {
      sub.pendingCommissionRateBps = plan.commissionRateBps ?? null;
    }
    sub.pendingAdjustment = {
      amount: roundMoney((sub.pendingAdjustment?.amount || 0) + prorated),
      label: `Plan change ${before.planCode} → ${plan.code} (pro-rata)`,
    };
    sub.changedAt = new Date();
    await sub.save();

    // plan features may toggle marketplace mode
    await Tenant.updateOne({ _id: tenantId }, {
      $set: {
        plan: plan.code,
        'features.marketplaceEnabled': Boolean(plan.features?.marketplaceEnabled),
        'features.subscriptionsEnabled': Boolean(plan.features?.marketplaceEnabled),
      },
    });

    await auditService.record({
      action: 'plan_change', entityType: 'subscription', entityId: sub._id,
      tenantId, actorId, actorType: 'admin',
      before,
      after: {
        planCode: plan.code,
        priceMonthly: plan.priceMonthly,
        prorated,
        commissionRateBps: sub.commissionRateBps,
        pendingCommissionRateBps: sub.pendingCommissionRateBps ?? null,
        rateEffective: sub.pendingCommissionRateBps != null ? 'next_period' : 'unchanged',
      },
      req,
    }).catch(() => {});
    return {
      subscription: sub,
      changed: true,
      prorated,
      rateEffective: sub.pendingCommissionRateBps != null ? 'next_period' : 'unchanged',
    };
  }

  // ---------------- invoices ----------------
  async listInvoices({ tenantId = null, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = {};
    if (tenantId) q.tenantId = tenantId;
    if (query.status) q.status = query.status;
    const [docs, total] = await Promise.all([
      Invoice.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Invoice.countDocuments(q),
    ]);
    return { items: serializeList(docs), meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: (page - 1) * limit + docs.length < total } };
  }

  async invoiceDetail({ invoiceId, tenantId = null }) {
    const q = { _id: invoiceId };
    if (tenantId) q.tenantId = tenantId;
    const invoice = await Invoice.findOne(q).lean();
    if (!invoice) throw notFound('Invoice not found', 'INVOICE_NOT_FOUND');
    const tenant = await Tenant.findById(invoice.tenantId).select('name slug').lean();
    return { ...invoice, id: invoice._id, tenant: tenant || null };
  }

  /** Period GMV (excludes cancelled): rollup-first, orders fallback. */
  async periodGmv({ tenantId, from, to }) {
    const rolled = await AnalyticsDaily.aggregate([
      { $match: { tenantId, hubId: null, date: { $gte: from.toISOString().slice(0, 10), $lte: to.toISOString().slice(0, 10) } } },
      { $group: { _id: null, gmv: { $sum: '$gmv' } } },
    ]);
    if (rolled.length && rolled[0].gmv > 0) return roundMoney(rolled[0].gmv);
    // fallback: sum order totals (excl cancelled)
    const [agg] = await Order.aggregate([
      { $match: { tenantId, createdAt: { $gte: from, $lt: to }, status: { $ne: 'cancelled' }, isDeleted: { $ne: true } } },
      { $group: { _id: null, gmv: { $sum: '$totalAmount' } } },
    ]);
    return roundMoney(agg?.gmv || 0);
  }

  /**
   * Generate (or fetch) the invoice for a tenant's current period. Idempotent.
   *
   * Totals are signed-correct: taxable = fee + commission + adjustment (the
   * adjustment may be a downgrade CREDIT), GST applies to the taxable value,
   * total = taxable + GST. Line amounts stay non-negative for display — the
   * sign lives in the label and in the totals math, never in a negative
   * unitAmount (the schema forbids it, and a negative unit once crashed the
   * whole cycle on downgrades).
   *
   * Race-proof: the unique (tenant, period.from, period.to) index is the real
   * guard — two overlapping cycle runs (nightly + a manual admin trigger) both
   * pass the findOne check, one wins the insert, and the loser catches the
   * duplicate key and returns the winner's row instead of double-invoicing.
   */
  async generateInvoice({ tenantId, sub, actorId = null, req = null }) {
    const from = sub.periodStart;
    const to = sub.periodEnd;
    const existing = await Invoice.findOne({ tenantId, 'period.from': from, 'period.to': to });
    if (existing) return { invoice: existing, created: false };

    const gmv = await this.periodGmv({ tenantId, from, to });
    const inTrial = sub.status === TENANT_SUBSCRIPTION_STATUS.TRIAL && to <= (sub.trialEndsAt || new Date(0));
    const lineItems = [];

    // 1. subscription fee (waived while the whole period was inside the trial)
    const subFee = inTrial ? 0 : (sub.planSnapshot?.priceMonthly || 0);
    lineItems.push({
      type: INVOICE_LINE_TYPE.SUBSCRIPTION,
      label: inTrial ? `${sub.planSnapshot?.name || sub.planCode} — trial period (no charge)` : `${sub.planSnapshot?.name || sub.planCode} plan — monthly`,
      qty: 1,
      unitAmount: subFee,
      amount: subFee,
    });

    // 2. platform commission on period GMV (at the CURRENT-period rate — a
    // mid-period plan change never rewrites this; see changePlan)
    const commission = roundMoney((gmv * (sub.commissionRateBps || 0)) / 10000);
    lineItems.push({
      type: INVOICE_LINE_TYPE.COMMISSION,
      label: `Platform commission ${(sub.commissionRateBps || 0) / 100}% on GMV ${gmv.toFixed(2)}`,
      qty: 1,
      unitAmount: commission,
      amount: commission,
    });

    // 3. pending adjustment (plan change pro-rata, signed), then clear
    const adjustmentSigned = roundMoney(sub.pendingAdjustment?.amount || 0);
    if (adjustmentSigned !== 0) {
      const base = sub.pendingAdjustment.label || 'Adjustment';
      lineItems.push({
        type: INVOICE_LINE_TYPE.ADJUSTMENT,
        label: adjustmentSigned < 0 ? `${base} (credit)` : `${base} (charge)`,
        qty: 1,
        unitAmount: Math.abs(adjustmentSigned),
        amount: Math.abs(adjustmentSigned),
      });
    }

    // 4. GST on the platform's own services (fee + commission + adjustment)
    const gstBps = config.marketplace.invoiceGstBps || 0;
    const { taxable, gst, total } = computeInvoiceTotals({ fee: subFee, commission, adjustmentSigned, gstBps });
    if (gst > 0) {
      lineItems.push({
        type: INVOICE_LINE_TYPE.GST,
        label: `GST ${(gstBps / 100).toFixed(0)}% on ${taxable.toFixed(2)}`,
        qty: 1,
        unitAmount: gst,
        amount: gst,
      });
    }

    // Zero-value invoices (full trial, or credits covering everything) never
    // touch the gateway — a ₹0 Razorpay order would be rejected, and there is
    // nothing to collect. They finalise as paid at birth, like Stripe's $0
    // invoices. No ledger journal: no money moved, so there is nothing to book.
    const zeroValue = total <= 0;
    let invoice;
    try {
      invoice = await Invoice.create({
        tenantId,
        number: await nextInvoiceNumber(),
        period: { from, to },
        dueAt: new Date(to.getTime() + config.marketplace.invoiceGraceDays * 86400000),
        lineItems,
        subtotal: taxable,
        total,
        status: zeroValue ? INVOICE_STATUS.PAID : INVOICE_STATUS.OPEN,
        paidAt: zeroValue ? new Date() : null,
        paymentRef: zeroValue ? 'zero_value' : null,
        generatedBy: actorId || null,
      });
    } catch (err) {
      if (err?.code === 11000) {
        const raced = await Invoice.findOne({ tenantId, 'period.from': from, 'period.to': to });
        if (raced) return { invoice: raced, created: false };
      }
      throw err;
    }

    // clear the applied adjustment
    if (adjustmentSigned !== 0) {
      sub.pendingAdjustment = { amount: 0, label: null };
      await sub.save();
    }

    await auditService.record({
      action: zeroValue ? 'invoice_auto_paid' : 'invoice_generated', entityType: 'invoice', entityId: invoice._id,
      tenantId, actorId, actorType: actorId ? 'admin' : 'system',
      after: { number: invoice.number, total: invoice.total, gmv, taxable, gst, zeroValue }, req,
    }).catch(() => {});
    return { invoice, created: true };
  }

  /**
   * Billing cycle: rollover statuses → invoice due periods → advance periods.
   *
   * Runs over a CURSOR (never a materialised array — the tenant table is
   * unbounded) and isolates failures per subscription: one poisoned row is
   * reported in `failures` and the cycle continues, so a single bad tenant
   * can never starve every other tenant's invoicing again.
   */
  async runBillingCycle({ tenantId = null, period = null, actorId = null, req = null } = {}) {
    const q = { status: { $in: LIVE_SUB_STATUSES } };
    if (tenantId) q.tenantId = tenantId;
    const now = period ? new Date(period) : new Date();

    let scanned = 0;
    let invoicesCreated = 0;
    let periodsAdvanced = 0;
    const failures = [];
    const out = [];
    const cursor = TenantSubscription.find(q).cursor();
    for await (const sub of cursor) {
      scanned += 1;
      try {
        const due = sub.periodEnd <= now;
        if (!due) continue;

        // sequential on purpose: per-tenant invoicing stays isolated so one poisoned row cannot starve the rest
        // eslint-disable-next-line no-await-in-loop
        const { created } = await this.generateInvoice({ tenantId: sub.tenantId, sub, actorId, req });
        if (created) invoicesCreated += 1;

        // advance the period
        sub.periodStart = sub.periodEnd;
        sub.periodEnd = addMonths(sub.periodEnd, 1);
        // a mid-period plan change takes its commission rate live NOW, on the
        // fresh period — the closed period billed at the old rate (see
        // changePlan's effective-dating note).
        if (sub.pendingCommissionRateBps != null) {
          const before = { commissionRateBps: sub.commissionRateBps };
          sub.commissionRateBps = sub.pendingCommissionRateBps;
          sub.pendingCommissionRateBps = null;
          // sequential on purpose: the audit follows its own rate activation inside the same per-tenant step
          // eslint-disable-next-line no-await-in-loop
          await auditService.record({
            action: 'commission_rate_effective', entityType: 'subscription', entityId: sub._id,
            tenantId: sub.tenantId, actorId, actorType: actorId ? 'admin' : 'system',
            before, after: { commissionRateBps: sub.commissionRateBps }, req,
          }).catch(() => {});
        }
        // trial rollover: after the trial period, the subscription becomes active
        if (sub.status === TENANT_SUBSCRIPTION_STATUS.TRIAL && sub.trialEndsAt && sub.trialEndsAt <= now) {
          sub.status = TENANT_SUBSCRIPTION_STATUS.ACTIVE;
        }
        if (sub.cancelAtPeriodEnd) {
          sub.status = TENANT_SUBSCRIPTION_STATUS.CANCELLED;
          sub.cancelAtPeriodEnd = false;
        }
        // sequential on purpose: the period advance must persist after its invoice in the same per-tenant step
        // eslint-disable-next-line no-await-in-loop
        await sub.save();
        periodsAdvanced += 1;
        out.push({ tenantId: sub.tenantId, invoiceCreated: created, advanced: true });
      } catch (err) {
        failures.push({ tenantId: String(sub.tenantId), error: err?.message || String(err), code: err?.code || null });
      }
    }
    return { scanned, invoicesCreated, periodsAdvanced, failures, out };
  }

  /**
   * Every delinquent invoice for a tenant (OVERDUE, or OPEN past its due date).
   * Lean rows: callers only ever need the count, the total owed, and the ids.
   */
  async delinquentInvoices({ tenantId, now = new Date() }) {
    return Invoice.find({
      tenantId,
      $or: [
        { status: INVOICE_STATUS.OVERDUE },
        { status: INVOICE_STATUS.OPEN, dueAt: { $lte: now } },
      ],
    }).select('_id number total status dueAt').lean();
  }

  /**
   * THE standing choke point — the ONLY writer of trial/active ↔ past_due.
   *
   * Recomputes a tenant's standing from the CURRENT delinquency count and
   * transitions it via standingFor(): debt appears → past_due; debt FULLY
   * clears → active. Paying one invoice while older ones stay overdue therefore
   * keeps the block — the loophole where ANY single payment cleared past_due
   * is closed here, once, for every caller (pay confirm, webhook confirm, void,
   * sweep). Transitions are audited with the before/after and the amount owed.
   */
  async refreshStanding({ tenantId, actorId = null, actorType = 'system', reason = null, req = null }) {
    const now = new Date();
    const delinquent = await this.delinquentInvoices({ tenantId, now });
    const delinquentTotal = roundMoney(delinquent.reduce((a, d) => a + (Number(d.total) || 0), 0));
    const sub = await TenantSubscription.findOne({ tenantId, status: { $in: LIVE_SUB_STATUSES } });
    if (!sub) return { status: null, changed: false, delinquentCount: delinquent.length, delinquentTotal };
    const next = standingFor({ currentStatus: sub.status, delinquentCount: delinquent.length });
    if (next === sub.status) {
      return { status: sub.status, changed: false, delinquentCount: delinquent.length, delinquentTotal };
    }
    const before = sub.status;
    sub.status = next;
    sub.changedAt = now;
    await sub.save();
    await auditService.record({
      action: 'subscription_standing', entityType: 'subscription', entityId: sub._id,
      tenantId, actorId, actorType,
      before: { status: before },
      after: { status: next, delinquentCount: delinquent.length, delinquentTotal, reason }, req,
    }).catch(() => {});
    return { status: next, changed: true, delinquentCount: delinquent.length, delinquentTotal };
  }

  /**
   * Overdue sweep, in two passes (both idempotent, both bounded):
   *
   * 1. TRANSITIONS — OPEN invoices whose due date has passed flip to OVERDUE
   *    and the owner gets ONE dunning notice per invoice (dedupeKey-keyed, so
   *    re-runs never double-notify). Single grace: the invoice's own dueAt
   *    (period end + invoiceGraceDays) is the deadline — the sweep no longer
   *    stacks a second hidden grace window on top of it.
   * 2. SELF-HEAL — any tenant holding an OVERDUE invoice whose subscription is
   *    not past_due is moved there (covers pre-hardening rows and any drift:
   *    after this pass, "OVERDUE invoice ⇒ past_due subscription" holds
   *    platform-wide, always).
   *
   * Standing itself is written only through refreshStanding().
   */
  async overdueSweep({ req = null, limit = 2000 } = {}) {
    const now = new Date();
    let markedOverdue = 0;
    let notified = 0;
    const touched = new Set();
    const failures = [];

    const cursor = Invoice.find({ status: INVOICE_STATUS.OPEN, dueAt: { $lte: now } })
      .select('_id tenantId number total dueAt')
      .limit(limit)
      .cursor();
    for await (const inv of cursor) {
      try {
        // atomic guard: a concurrent pay-confirm may have just taken it
        // sequential on purpose: guarded flips commit in turn per invoice; the cursor keeps it bounded
        // eslint-disable-next-line no-await-in-loop
        const flipped = await Invoice.updateOne(
          { _id: inv._id, status: INVOICE_STATUS.OPEN },
          { $set: { status: INVOICE_STATUS.OVERDUE } }
        );
        if (flipped.modifiedCount === 0) continue; // paid/voided under us — not ours to flag
        markedOverdue += 1;
        touched.add(String(inv.tenantId));
        // sequential on purpose: one dunning notice per flipped invoice, in turn
        // eslint-disable-next-line no-await-in-loop
        const sent = await this.notifyInvoiceOverdue({ invoice: inv }).catch(() => false);
        if (sent) {
          notified += 1;
          // sequential on purpose: stamps the notice just sent for this invoice
          // eslint-disable-next-line no-await-in-loop
          await Invoice.updateOne({ _id: inv._id }, { $set: { lastReminderAt: now } }).catch(() => {});
        }
      } catch (err) {
        failures.push({ invoiceId: String(inv._id), error: err?.message || String(err) });
      }
    }

    let transitions = 0;
    for (const tenantId of touched) {
      try {
        // sequential on purpose: standing transitions commit one tenant at a time
        // eslint-disable-next-line no-await-in-loop
        const r = await this.refreshStanding({ tenantId, reason: 'overdue_sweep', req });
        if (r.changed) transitions += 1;
      } catch (err) {
        failures.push({ tenantId, error: err?.message || String(err) });
      }
    }

    // pass 2 — self-heal: OVERDUE invoices must imply past_due, no exceptions
    let healed = 0;
    try {
      const holders = await Invoice.aggregate([
        { $match: { status: INVOICE_STATUS.OVERDUE } },
        { $group: { _id: '$tenantId' } },
        { $limit: 10000 },
      ]);
      const holderIds = holders.map((h) => h._id);
      if (holderIds.length) {
        const res = await TenantSubscription.updateMany(
          { tenantId: { $in: holderIds }, status: { $in: [TENANT_SUBSCRIPTION_STATUS.TRIAL, TENANT_SUBSCRIPTION_STATUS.ACTIVE] } },
          { $set: { status: TENANT_SUBSCRIPTION_STATUS.PAST_DUE, changedAt: now } }
        );
        healed = res.modifiedCount || 0;
        if (healed > 0) {
          await auditService.record({
            action: 'subscription_standing_heal', entityType: 'subscription', entityId: null,
            tenantId: null, actorId: null, actorType: 'system',
            after: { healed, reason: 'overdue_sweep_self_heal' }, req,
          }).catch(() => {});
        }
      }
    } catch (err) {
      failures.push({ tenantId: '*', error: err?.message || String(err) });
    }

    return { markedOverdue, notified, transitions, healed, failures };
  }

  /**
   * ONE dunning notice per invoice to the store owner (template `invoice_overdue`,
   * platform default; a tenant may override the copy). Never throws — a
   * notification failure must not fail the sweep — and reports whether this
   * run actually created the notice (re-runs dedupe to `duplicate`).
   */
  async notifyInvoiceOverdue({ invoice }) {
    try {
      const tenant = await Tenant.findById(invoice.tenantId).select('ownerUserId name slug').lean();
      const ownerUserId = tenant?.ownerUserId;
      if (!ownerUserId) return false;
      const { default: notificationService } = await import('./notification.service.js');
      const r = await notificationService.dispatch({
        tenantId: invoice.tenantId,
        userId: ownerUserId,
        templateCode: 'invoice_overdue',
        data: {
          storeName: tenant?.name || tenant?.slug || 'your store',
          invoiceNumber: invoice.number,
          total: Number(invoice.total || 0).toFixed(2),
          dueDate: invoice.dueAt ? new Date(invoice.dueAt).toISOString().slice(0, 10) : '',
        },
        dedupeKey: `invoice_overdue:${invoice._id}`,
      });
      return r.created === true;
    } catch {
      return false;
    }
  }

  /**
   * Pay an invoice via the billing provider. Idempotent (already-paid returns
   * as-is). Two flows share this method:
   *   - mock/console provider: synchronous — the invoice is marked paid here.
   *   - razorpay: ASYNC — charge() creates a gateway order and returns
   *     {pending:true}; the invoice stays open with paymentRef=<gateway order>
   *     until the webhook confirms (confirmInvoicePayment()).
   * `tenantId`, when given (store-owner path), scopes the lookup so an owner
   * can only ever pay their OWN store's invoices.
   */
  async payInvoice({ invoiceId, tenantId = null, actorId = null, actorType = null, req = null }) {
    const q = { _id: invoiceId };
    if (tenantId) q.tenantId = tenantId;
    const invoice = await Invoice.findOne(q);
    if (!invoice) throw notFound('Invoice not found', 'INVOICE_NOT_FOUND');
    if (invoice.status === INVOICE_STATUS.PAID) return { status: 'already_paid', invoice, alreadyPaid: true, pending: false };
    if (invoice.status === INVOICE_STATUS.VOID) throw conflict('Void invoice cannot be paid', 'INVOICE_VOID');

    const result = await billingProvider.charge({ invoiceId: invoice._id, amount: invoice.total, currency: 'INR' });
    if (result.pending) {
      // Async gateway: park the gateway order id and wait for the webhook.
      // Re-pay while pending returns the SAME order (provider-keyed idempotency).
      if (!invoice.paymentRef) {
        invoice.paymentRef = result.gatewayOrderId;
        await invoice.save();
      }
      return {
        status: 'pending', invoice, alreadyPaid: false, pending: true,
        gateway: {
          provider: result.provider || 'razorpay',
          gatewayOrderId: invoice.paymentRef,
          keyId: result.keyId || null,
          amountPaise: result.amountPaise,
          currency: result.currency || 'INR',
        },
      };
    }
    if (!result.success) throw badRequest('Payment failed', 'PAYMENT_FAILED');
    await this.confirmInvoicePayment({ invoice, paymentRef: result.ref || `pay_${generateOpaqueToken(8)}` });
    await auditService.record({
      action: 'invoice_paid', entityType: 'invoice', entityId: invoice._id,
      tenantId: invoice.tenantId, actorId, actorType: actorType || (actorId ? 'admin' : 'system'),
      after: { number: invoice.number, total: invoice.total, paymentRef: invoice.paymentRef }, req,
    }).catch(() => {});
    return { status: 'paid', invoice, alreadyPaid: false, pending: false };
  }

  /**
   * Mark an invoice paid (shared by sync charge + async webhook confirm).
   *
   * Concurrency-proof: the status flip is ONE guarded update, so two racing
   * confirms (webhook retry + owner re-pay) cannot both "win" — the loser
   * re-reads, sees PAID, and returns idempotently. Ordering is deliberate:
   * money-state first, standing second, books third. The journal post can only
   * fail on something the nightly `backfillInvoicePayments()` repairs, while a
   * standing update skipped by a throw would strand a paying tenant in
   * past_due — so standing refreshes BEFORE the journal is attempted.
   */
  async confirmInvoicePayment({ invoice, paymentRef }) {
    if (invoice.status === INVOICE_STATUS.PAID) {
      await this.refreshStanding({ tenantId: invoice.tenantId, reason: 'invoice_reconfirm' }).catch(() => {});
      return invoice;
    }
    if (invoice.status === INVOICE_STATUS.VOID) throw conflict('Void invoice cannot be paid', 'INVOICE_VOID');

    const now = new Date();
    const won = await Invoice.updateOne(
      { _id: invoice._id, status: { $in: [INVOICE_STATUS.OPEN, INVOICE_STATUS.OVERDUE] } },
      { $set: { status: INVOICE_STATUS.PAID, paidAt: now, paymentRef: paymentRef || invoice.paymentRef || null } }
    );
    let fresh = await Invoice.findById(invoice._id);
    if (won.modifiedCount === 0) {
      // lost the race — whoever won defines the outcome, we just report it
      if (fresh?.status === INVOICE_STATUS.PAID) {
        await this.refreshStanding({ tenantId: fresh.tenantId, reason: 'invoice_reconfirm' }).catch(() => {});
        return fresh;
      }
      throw conflict('Invoice is no longer payable', 'INVOICE_RACE', { status: fresh?.status || null });
    }

    // standing BEFORE books (see the ordering note above): the block lifts
    // only when this was the LAST delinquent invoice.
    await this.refreshStanding({ tenantId: fresh.tenantId, reason: 'invoice_paid' }).catch(() => {});

    // recognise the money: DR gateway_clearing / CR subscription + commission
    // income + platform GST. Idempotent on the invoice id; safePost keeps a
    // transient ledger failure from failing an already-captured payment, and
    // the nightly backfill posts whatever the live path missed.
    const { default: ledgerPostingService } = await import('./ledgerPosting.service.js');
    await ledgerPostingService.safePost('invoice_paid', () =>
      ledgerPostingService.postInvoicePaid({ invoice: fresh })
    );

    return fresh;
  }

  async voidInvoice({ invoiceId, actorId = null, req = null }) {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) throw notFound('Invoice not found', 'INVOICE_NOT_FOUND');
    if (invoice.status === INVOICE_STATUS.PAID) throw conflict('Paid invoices cannot be voided', 'INVOICE_PAID');
    invoice.status = INVOICE_STATUS.VOID;
    await invoice.save();
    // voiding forgives THIS invoice's debt, so standing must be re-derived:
    // voiding the last delinquent invoice unblocks checkout, voiding one of
    // several keeps the block. Same choke point as payment — no special cases.
    const standing = await this.refreshStanding({ tenantId: invoice.tenantId, actorId, actorType: 'admin', reason: 'invoice_void', req }).catch(() => null);
    await auditService.record({
      action: 'invoice_void', entityType: 'invoice', entityId: invoice._id,
      tenantId: invoice.tenantId, actorId, actorType: 'admin',
      after: { number: invoice.number, standing: standing?.status || null }, req,
    }).catch(() => {});
    return invoice;
  }

  /**
   * Async-gateway event pipeline (Razorpay `payment.captured` / `order.paid`,
   * or the mock webhook). Mirrors paymentService.applyWebhookEvent discipline:
   *   - idempotent: an already-paid invoice acks as already_paid (gateway
   *     retries are normal traffic, not errors);
   *   - amount-checked: captured paise must equal the invoice total, else the
   *     event is recorded as mismatched and the invoice stays open for an
   *     operator (never auto-confirm a wrong amount);
   *   - failures ack without state change (the owner retries from the console).
   */
  async applyBillingWebhook({ provider, eventType, gatewayOrderId, gatewayPaymentId = null, amountPaise = null }) {
    const invoice = gatewayOrderId
      ? await Invoice.findOne({ paymentRef: gatewayOrderId })
      : null;
    if (!invoice) return { status: 'ignored', reason: 'no invoice parked for gateway order' };
    if (invoice.status === INVOICE_STATUS.PAID) return { status: 'already_paid', invoiceId: invoice._id };
    if (invoice.status === INVOICE_STATUS.VOID) return { status: 'ignored', reason: 'invoice void' };

    const captured = String(eventType || '').includes('captured') || String(eventType || '').includes('paid');
    if (!captured) return { status: 'ignored', reason: `event ${eventType} carries no capture` };

    const expectedPaise = Math.round(Number(invoice.total || 0) * 100);
    if (amountPaise != null && Number(amountPaise) !== expectedPaise) {
      console.warn(`[billing:${provider}] amount mismatch on invoice ${invoice.number}: captured ${amountPaise}paise, expected ${expectedPaise}paise — held for operator`);
      return { status: 'mismatched', invoiceId: invoice._id, expectedPaise, amountPaise: Number(amountPaise) };
    }

    await this.confirmInvoicePayment({ invoice, paymentRef: gatewayPaymentId || gatewayOrderId });
    await auditService.record({
      action: 'invoice_paid', entityType: 'invoice', entityId: invoice._id,
      tenantId: invoice.tenantId, actorId: null, actorType: 'system',
      after: { number: invoice.number, total: invoice.total, paymentRef: invoice.paymentRef, via: `webhook:${provider}` },
    }).catch(() => {});
    return { status: 'confirmed', invoiceId: invoice._id };
  }

  /** MRR: sum of live subscriptions' snapshot price. */
  async mrr() {
    const [agg] = await TenantSubscription.aggregate([
      { $match: { status: { $in: LIVE_SUB_STATUSES } } },
      { $group: { _id: null, mrr: { $sum: '$planSnapshot.priceMonthly' } } },
    ]);
    return roundMoney(agg?.mrr || 0);
  }
}

export default new BillingService();
