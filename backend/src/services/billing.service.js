/**
 * BillingService — subscriptions, invoices, billing cycle (Phase 5).
 *
 * - One live subscription per tenant (partial unique index).
 * - Invoices unique per (tenant, period.from, period.to) → the billing cycle
 *   is idempotent; re-running a period never duplicates.
 * - Plan change mid-period writes a pro-rata pendingAdjustment applied to the
 *   next invoice (then cleared). Pricing is snapshotted — history never mutates.
 * - Payments go through billingProvider (mock default).
 */

import Subscription from '../models/subscription.model.js';
import Invoice from '../models/invoice.model.js';
import AnalyticsDaily from '../models/analyticsDaily.model.js';
import Order from '../models/order.model.js';
import Tenant from '../models/tenant.model.js';
import planService from './plan.service.js';
import billingProvider from './billingProvider.service.js';
import auditService from './audit.service.js';
import { serializeList } from '../utils/serialize.js';
import { notFound, badRequest, conflict } from '../utils/ApiError.js';
import { roundMoney, moneySum } from '../utils/money.js';
import { generateOpaqueToken } from '../utils/hash.js';
import config from '../config/index.js';
import {
  SUBSCRIPTION_STATUS,
  INVOICE_STATUS,
  INVOICE_LINE_TYPE,
} from '../constants/enums.js';

const MONTH_MS = 30 * 24 * 3600 * 1000;

function addMonths(d, n = 1) {
  const nd = new Date(d);
  nd.setUTCMonth(nd.getUTCMonth() + n);
  return nd;
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
  async ensureSubscription({ tenantId, planCode, commissionRateBps = null, trialDays = 0, actorId = null }) {
    const plan = await planService.getByCode(planCode);
    const existing = await Subscription.findOne({ tenantId, status: { $in: ['trial', 'active', 'past_due'] } });
    if (existing) return { subscription: existing, created: false };

    const now = new Date();
    const periodEnd = addMonths(now, 1);
    const subscription = await Subscription.create({
      tenantId,
      planCode: plan.code,
      planSnapshot: { name: plan.name, priceMonthly: plan.priceMonthly },
      commissionRateBps: commissionRateBps ?? plan.commissionRateBps,
      currency: plan.currency || 'INR',
      status: trialDays > 0 ? SUBSCRIPTION_STATUS.TRIAL : SUBSCRIPTION_STATUS.ACTIVE,
      periodStart: now,
      periodEnd,
      trialEndsAt: trialDays > 0 ? new Date(now.getTime() + trialDays * 86400000) : null,
      cancelAtPeriodEnd: false,
      pendingAdjustment: { amount: 0, label: null },
      changedAt: now,
    });
    return { subscription, created: true };
  }

  async currentSubscription({ tenantId }) {
    return Subscription.findOne({ tenantId, status: { $in: ['trial', 'active', 'past_due'] } }).lean();
  }

  async subscriptionsForTenants(tenantIds) {
    if (!tenantIds.length) return [];
    return Subscription.find({ tenantId: { $in: tenantIds }, status: { $in: ['trial', 'active', 'past_due'] } }).lean();
  }

  /** Plan change: snapshot updates now, price difference applies from next period. */
  async changePlan({ tenantId, planCode, actorId = null, req = null }) {
    const plan = await planService.getByCode(planCode);
    let sub = await Subscription.findOne({ tenantId, status: { $in: ['trial', 'active', 'past_due'] } });
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
    sub.commissionRateBps = plan.commissionRateBps;
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
      before, after: { planCode: plan.code, priceMonthly: plan.priceMonthly, prorated }, req,
    }).catch(() => {});
    return { subscription: sub, changed: true, prorated };
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

  /** Generate (or fetch) the invoice for a tenant's current period. Idempotent. */
  async generateInvoice({ tenantId, sub, actorId = null, req = null }) {
    const from = sub.periodStart;
    const to = sub.periodEnd;
    const existing = await Invoice.findOne({ tenantId, 'period.from': from, 'period.to': to });
    if (existing) return { invoice: existing, created: false };

    const gmv = await this.periodGmv({ tenantId, from, to });
    const inTrial = sub.status === SUBSCRIPTION_STATUS.TRIAL && to <= (sub.trialEndsAt || new Date(0));
    const lineItems = [];

    // 1. subscription fee (waived while the whole period was inside the trial)
    const subFee = inTrial ? 0 : (sub.planSnapshot.priceMonthly || 0);
    lineItems.push({
      type: INVOICE_LINE_TYPE.SUBSCRIPTION,
      label: inTrial ? `${sub.planSnapshot.name} — trial period (no charge)` : `${sub.planSnapshot.name} plan — monthly`,
      qty: 1,
      unitAmount: subFee,
      amount: subFee,
    });

    // 2. platform commission on period GMV
    const commission = roundMoney((gmv * (sub.commissionRateBps || 0)) / 10000);
    lineItems.push({
      type: INVOICE_LINE_TYPE.COMMISSION,
      label: `Platform commission ${(sub.commissionRateBps || 0) / 100}% on GMV ${gmv.toFixed(2)}`,
      qty: 1,
      unitAmount: commission,
      amount: commission,
    });

    // 3. pending adjustment (plan change pro-rata), then clear
    if (sub.pendingAdjustment?.amount) {
      lineItems.push({
        type: INVOICE_LINE_TYPE.ADJUSTMENT,
        label: sub.pendingAdjustment.label || 'Adjustment',
        qty: 1,
        unitAmount: sub.pendingAdjustment.amount,
        amount: Math.abs(sub.pendingAdjustment.amount),
      });
    }

    const subtotal = roundMoney(lineItems.reduce((a, l) => a + l.amount, 0));
    const total = roundMoney(subtotal + (sub.pendingAdjustment?.amount || 0)); // signed adjustment
    const invoice = await Invoice.create({
      tenantId,
      number: await nextInvoiceNumber(),
      period: { from, to },
      dueAt: new Date(to.getTime() + config.marketplace.invoiceGraceDays * 86400000),
      lineItems,
      subtotal,
      total: Math.max(0, total),
      status: INVOICE_STATUS.OPEN,
      generatedBy: actorId || null,
    });

    // clear the applied adjustment
    if (sub.pendingAdjustment?.amount) {
      sub.pendingAdjustment = { amount: 0, label: null };
      await sub.save();
    }

    await auditService.record({
      action: 'invoice_generated', entityType: 'invoice', entityId: invoice._id,
      tenantId, actorId, actorType: actorId ? 'admin' : 'system',
      after: { number: invoice.number, total: invoice.total, gmv }, req,
    }).catch(() => {});
    return { invoice, created: true };
  }

  /** Billing cycle: rollover statuses → invoice due periods → advance periods. */
  async runBillingCycle({ tenantId = null, period = null, actorId = null, req = null } = {}) {
    const q = { status: { $in: ['trial', 'active', 'past_due'] } };
    if (tenantId) q.tenantId = tenantId;
    const subs = await Subscription.find(q);

    let invoicesCreated = 0;
    let periodsAdvanced = 0;
    const out = [];
    for (const sub of subs) {
      const due = sub.periodEnd <= (period ? new Date(period) : new Date());
      if (!due) continue;

      const { created } = await this.generateInvoice({ tenantId: sub.tenantId, sub, actorId, req });
      if (created) invoicesCreated += 1;

      // advance the period
      sub.periodStart = sub.periodEnd;
      sub.periodEnd = addMonths(sub.periodEnd, 1);
      // trial rollover: after the trial period, the subscription becomes active
      if (sub.status === SUBSCRIPTION_STATUS.TRIAL && sub.trialEndsAt && sub.trialEndsAt <= new Date()) {
        sub.status = SUBSCRIPTION_STATUS.ACTIVE;
      }
      if (sub.cancelAtPeriodEnd) {
        sub.status = SUBSCRIPTION_STATUS.CANCELLED;
        sub.cancelAtPeriodEnd = false;
      }
      await sub.save();
      periodsAdvanced += 1;
      out.push({ tenantId: sub.tenantId, invoiceCreated: created, advanced: true });
    }
    return { scanned: subs.length, invoicesCreated, periodsAdvanced, out };
  }

  /** Overdue sweep: open invoices past due+grace → overdue; subscriptions → past_due. */
  async overdueSweep({ req = null } = {}) {
    const cutoff = new Date(Date.now() - config.marketplace.invoiceGraceDays * 86400000);
    const overdue = await Invoice.find({ status: INVOICE_STATUS.OPEN, dueAt: { $lte: cutoff } });
    for (const inv of overdue) {
      inv.status = INVOICE_STATUS.OVERDUE;
      await inv.save();
      await Subscription.updateOne(
        { tenantId: inv.tenantId, status: { $in: ['trial', 'active'] } },
        { $set: { status: SUBSCRIPTION_STATUS.PAST_DUE, changedAt: new Date() } }
      );
    }
    return { markedOverdue: overdue.length };
  }

  /** Mock payment via provider → paid. Idempotent (already-paid returns as-is). */
  async payInvoice({ invoiceId, actorId = null, req = null }) {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) throw notFound('Invoice not found', 'INVOICE_NOT_FOUND');
    if (invoice.status === INVOICE_STATUS.PAID) return { invoice, alreadyPaid: true };
    if (invoice.status === INVOICE_STATUS.VOID) throw conflict('Void invoice cannot be paid', 'INVOICE_VOID');

    const result = await billingProvider.charge({ invoiceId: invoice._id, amount: invoice.total, currency: 'INR' });
    if (!result.success) throw badRequest('Payment failed', 'PAYMENT_FAILED');
    invoice.status = INVOICE_STATUS.PAID;
    invoice.paidAt = new Date();
    invoice.paymentRef = result.ref || `pay_${generateOpaqueToken(8)}`;
    await invoice.save();

    // paying clears past_due
    await Subscription.updateOne(
      { tenantId: invoice.tenantId, status: SUBSCRIPTION_STATUS.PAST_DUE },
      { $set: { status: SUBSCRIPTION_STATUS.ACTIVE, changedAt: new Date() } }
    );

    await auditService.record({
      action: 'invoice_paid', entityType: 'invoice', entityId: invoice._id,
      tenantId: invoice.tenantId, actorId, actorType: actorId ? 'admin' : 'system',
      after: { number: invoice.number, total: invoice.total, paymentRef: invoice.paymentRef }, req,
    }).catch(() => {});
    return { invoice, alreadyPaid: false };
  }

  async voidInvoice({ invoiceId, actorId = null, req = null }) {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) throw notFound('Invoice not found', 'INVOICE_NOT_FOUND');
    if (invoice.status === INVOICE_STATUS.PAID) throw conflict('Paid invoices cannot be voided', 'INVOICE_PAID');
    invoice.status = INVOICE_STATUS.VOID;
    await invoice.save();
    await auditService.record({
      action: 'invoice_void', entityType: 'invoice', entityId: invoice._id,
      tenantId: invoice.tenantId, actorId, actorType: 'admin',
      after: { number: invoice.number }, req,
    }).catch(() => {});
    return invoice;
  }

  /** MRR: sum of live subscriptions' snapshot price. */
  async mrr() {
    const [agg] = await Subscription.aggregate([
      { $match: { status: { $in: ['trial', 'active', 'past_due'] } } },
      { $group: { _id: null, mrr: { $sum: '$planSnapshot.priceMonthly' } } },
    ]);
    return roundMoney(agg?.mrr || 0);
  }
}

export default new BillingService();
