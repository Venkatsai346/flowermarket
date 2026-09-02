import mongoose from 'mongoose';
import PayoutLineItem from '../models/payoutLineItem.model.js';
import PayoutBatch from '../models/payoutBatch.model.js';
import PayoutPolicy from '../models/payoutPolicy.model.js';
import PayoutAdjustment from '../models/payoutAdjustment.model.js';
import PayoutStatusHistory from '../models/payoutStatusHistory.model.js';
import VendorPayoutAccount from '../models/vendorPayoutAccount.model.js';
import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import ProductMaster from '../models/productMaster.model.js';
import Vendor from '../models/vendor.model.js';
import Counter from '../models/counter.model.js';
import LedgerJournal from '../models/ledgerJournal.model.js';
import taxService from './tax.service.js';
import ledgerService, { ledgerAccounts } from './ledger.service.js';
import payoutProvider from './payoutProvider.service.js';
import auditService from './audit.service.js';
import config from '../config/index.js';
import { AppError, badRequest, conflict, notFound } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';
import { toPaise, fromPaise, sumPaise, applyBps } from '../utils/money.js';
import { assertTransition, PAYOUT_IN_FLIGHT } from '../utils/payoutStateMachine.js';
import {
  PAYOUT_LINE_STATE, PAYOUT_STATE, PAYOUT_HOLD_REASON, STATUTORY_RATE_KIND,
  LEDGER_JOURNAL_KIND, ORDER_STATUS, AUDIT_ACTION, AUDIT_ACTOR_TYPE,
} from '../constants/enums.js';

/**
 * PayoutService — accrual, eligibility and cycle computation (Phase 6.3 / M4).
 *
 * ── The two gates ───────────────────────────────────────────────────────────
 * A line becomes payable only when BOTH are open:
 *   1. RETURN RISK — `deliveredAt + returnWindowDays` has passed. Paying before
 *      that means buying back your own goods.
 *   2. CASH IN HAND — the PSP has actually settled the money to us (a
 *      `psp_settled` ledger entry covering the order). Paying before that is
 *      lending the vendor our own working capital. Gated by
 *      `policy.requirePspSettlement`, off until settlement ingestion (M5).
 *
 * ── The arithmetic, and why it is a pure function ───────────────────────────
 * `computeLineFinancials()` takes numbers and returns numbers. No database, no
 * clock. That is what lets `scripts/payout-calc.test.js` assert the worked
 * example to the paisa without any infrastructure — and a vendor payout is
 * exactly the kind of number that must be checkable by hand.
 *
 *   gross     5900.00   what the customer paid (incl. the seller's GST)
 *   − commission 10% of the taxable value       −500.00
 *   − GST on that commission @18%                −90.00
 *   − TCS u/s 52 on the taxable value            −25.00
 *   − TDS u/s 194-O on gross                      −5.90
 *   = net payable                               5279.10
 *
 * ── The ledger view ─────────────────────────────────────────────────────────
 * `sale_captured` already split the customer's money three ways:
 *   vendor_payable = taxable − commission,  gst_output_payable:{vendor} = GST,
 *   platform_commission_income = commission.
 * A payout therefore DRAINS the first two and books the statutory liabilities:
 *
 *   DR vendor_payable:{v}            taxable − commission     (4500.00)
 *   DR gst_output_payable:{v}        seller's GST              (900.00)
 *       CR bank                      net payable              (5279.10)
 *       CR gst_output_payable:platform  GST on commission        (90.00)
 *       CR tcs_payable                                           (25.00)
 *       CR tds_payable                                            (5.90)
 *
 * The seller's GST flows TO the seller because the seller is the person who
 * must deposit it; only TCS is withheld and deposited by the platform.
 */

const toId = (v) => (v == null ? null : (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v))));

/** Platform default, used when no PayoutPolicy row exists yet. */
export const DEFAULT_POLICY = Object.freeze({
  schedule: 'weekly:wed',
  minPayoutPaise: 50000,
  returnWindowDays: 7,
  perishableReturnWindowDays: 1,
  requirePspSettlement: false,
  commissionGstBps: 1800,
  deductions: { commission: true, gstOnCommission: true, tcs: true, tds: true },
  holdOnDispute: true,
  negativeBalanceCarryForward: true,
  dualApprovalPaise: 10000000,
  maxBatchPaise: 50000000,
});

/**
 * PURE. Compute every deduction for one sold line.
 *
 * @param {object} p
 * @param {number} p.lineTotalPaise      pre-discount line value
 * @param {number} [p.discountPaise]
 * @param {number} [p.sellerGstPaise]    GST charged to the customer on this line
 * @param {number} p.commissionRateBps
 * @param {number} [p.commissionGstBps]
 * @param {number} [p.tcsRateBps]        0 disables
 * @param {number} [p.tdsRateBps]        0 disables
 * @param {number} [p.shippingSharePaise]
 * @param {object} [p.deductions]        per-policy on/off switches
 * @param {number} [p.sign]              -1 builds the reversal of this line
 */
export function computeLineFinancials({
  lineTotalPaise,
  discountPaise = 0,
  sellerGstPaise = 0,
  commissionRateBps = 0,
  commissionGstBps = 1800,
  tcsRateBps = 0,
  tdsRateBps = 0,
  shippingSharePaise = 0,
  deductions = DEFAULT_POLICY.deductions,
  sign = 1,
}) {
  const taxableValuePaise = Math.round(lineTotalPaise) - Math.round(discountPaise);
  if (taxableValuePaise < 0) {
    throw new AppError('Payout line: discount exceeds the line total', {
      status: 422, code: 'PAYOUT_NEGATIVE_LINE',
    });
  }
  const gstPaise = Math.round(sellerGstPaise);
  const grossPaise = taxableValuePaise + gstPaise;

  const commissionPaise = deductions.commission ? applyBps(taxableValuePaise, commissionRateBps) : 0;
  const gstOnCommissionPaise = deductions.gstOnCommission ? applyBps(commissionPaise, commissionGstBps) : 0;
  const tcsPaise = deductions.tcs ? applyBps(taxableValuePaise, tcsRateBps) : 0;
  const tdsPaise = deductions.tds ? applyBps(grossPaise, tdsRateBps) : 0;
  const shipping = Math.round(shippingSharePaise);

  const netPayablePaise = grossPaise - commissionPaise - gstOnCommissionPaise - tcsPaise - tdsPaise - shipping;

  const s = sign < 0 ? -1 : 1;
  return {
    grossPaise: s * grossPaise,
    taxableValuePaise: s * taxableValuePaise,
    sellerGstPaise: s * gstPaise,
    commissionRateBps,
    commissionPaise: s * commissionPaise,
    gstOnCommissionPaise: s * gstOnCommissionPaise,
    tcsRateBps,
    tcsPaise: s * tcsPaise,
    tdsRateBps,
    tdsPaise: s * tdsPaise,
    shippingSharePaise: s * shipping,
    netPayablePaise: s * netPayablePaise,
  };
}

class PayoutService {
  // -------------------------------------------------------------------------
  // policy
  // -------------------------------------------------------------------------

  /** Vendor override, else the platform row, else the built-in default. */
  async resolvePolicy({ vendorId = null } = {}) {
    const rows = await PayoutPolicy.find({
      isActive: true,
      $or: [{ scope: 'platform' }, ...(vendorId ? [{ scope: 'vendor', vendorId }] : [])],
    }).lean();
    const platform = rows.find((r) => r.scope === 'platform');
    const vendor = rows.find((r) => r.scope === 'vendor');
    return { ...DEFAULT_POLICY, ...(platform || {}), ...(vendor || {}) };
  }

  async upsertPolicy({ scope = 'platform', vendorId = null, payload, actorId = null, req = null }) {
    const doc = await PayoutPolicy.findOneAndUpdate(
      { scope, vendorId: toId(vendorId), isActive: true },
      { $set: { ...payload, scope, vendorId: toId(vendorId), isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await auditService.record({
      action: AUDIT_ACTION.UPDATE, entityType: 'payout_policy', entityId: doc._id,
      actorId, actorType: 'admin', after: payload, req,
    }).catch(() => {});
    return doc;
  }

  // -------------------------------------------------------------------------
  // accrual
  // -------------------------------------------------------------------------

  /**
   * Create payout lines for every VENDOR item on an order. Idempotent on
   * `orderItemId`, so re-running after a crash (or the nightly sweep) converges.
   *
   * Store-owned items are deliberately skipped: the store is billed monthly by
   * the Phase 5 cycle rather than settled per order — the same asymmetry the
   * sale journal encodes.
   */
  async accrueForOrder({ orderId, actorId = null }) {
    const order = await Order.findById(orderId).lean();
    if (!order) throw notFound('Order not found', 'ORDER_NOT_FOUND');

    const items = await OrderItem.find({ orderId: order._id, vendorId: { $ne: null } }).lean();
    if (!items.length) return { created: 0, skipped: 0, lines: [] };

    const supplyDate = order.paymentSummary?.paidAt || order.createdAt || new Date();
    const [tcsRate, tdsRate] = await Promise.all([
      taxService.resolveStatutoryRate({ kind: STATUTORY_RATE_KIND.TCS_GST_52, at: supplyDate }),
      taxService.resolveStatutoryRate({ kind: STATUTORY_RATE_KIND.TDS_194O, at: supplyDate }),
    ]);

    const vendorIds = [...new Set(items.map((i) => String(i.vendorId)))];
    const vendors = await Vendor.find({ _id: { $in: vendorIds } }).select('commissionRateBps').lean();
    const bpsByVendor = new Map(vendors.map((v) => [String(v._id), v.commissionRateBps]));

    const masters = await ProductMaster.find({ _id: { $in: items.map((i) => i.productMasterId).filter(Boolean) } })
      .select('_id isPerishable').lean();
    const perishableByMaster = new Map(masters.map((m) => [String(m._id), Boolean(m.isPerishable)]));

    let created = 0;
    let skipped = 0;
    const lines = [];

    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await PayoutLineItem.findOne({ orderItemId: item._id, reversalOfLineId: null }).lean();
      if (exists) { skipped += 1; lines.push(exists); continue; }

      // eslint-disable-next-line no-await-in-loop
      const policy = await this.resolvePolicy({ vendorId: item.vendorId });
      const financials = computeLineFinancials({
        lineTotalPaise: toPaise(item.lineTotal || 0),
        discountPaise: toPaise(item.discountAllocated || 0),
        sellerGstPaise: toPaise(item.taxAmount || 0),
        commissionRateBps: bpsByVendor.get(String(item.vendorId)) ?? config.marketplace.defaultCommissionBps,
        commissionGstBps: policy.commissionGstBps,
        tcsRateBps: tcsRate?.rateBps || 0,
        tdsRateBps: tdsRate?.rateBps || 0,
        deductions: policy.deductions,
      });

      const perishable = perishableByMaster.get(String(item.productMasterId));
      const windowDays = perishable ? policy.perishableReturnWindowDays : policy.returnWindowDays;
      const deliveredAt = order.status === ORDER_STATUS.DELIVERED ? (order.deliveredAt || order.updatedAt || null) : null;

      // eslint-disable-next-line no-await-in-loop
      const line = await PayoutLineItem.create({
        vendorId: item.vendorId,
        tenantId: order.tenantId,
        orderId: order._id,
        orderItemId: item._id,
        orderNumber: order.orderNumber,
        ...financials,
        state: PAYOUT_LINE_STATE.ACCRUED,
        deliveredAt,
        eligibleAt: deliveredAt ? new Date(new Date(deliveredAt).getTime() + windowDays * 86400000) : null,
      });
      created += 1;
      lines.push(line);
    }

    return { created, skipped, lines };
  }

  /**
   * Sweep: promote ACCRUED lines to ELIGIBLE once both gates are open.
   *
   * Written as a query rather than a loop over orders so it stays O(eligible)
   * rather than O(orders) as the platform grows.
   */
  async markEligible({ now = new Date(), limit = 1000 } = {}) {
    const policy = await this.resolvePolicy();

    // Gate 1: delivered + return window (eligibleAt is stamped at accrual, but
    // orders delivered AFTER accrual need it filled in now).
    const pending = await PayoutLineItem.find({
      state: PAYOUT_LINE_STATE.ACCRUED,
      $or: [{ eligibleAt: null }, { eligibleAt: { $lte: now } }],
    }).limit(limit);

    let promoted = 0;
    let waiting = 0;
    let blocked = 0;

    for (const line of pending) {
      if (!line.eligibleAt) {
        // eslint-disable-next-line no-await-in-loop
        const order = await Order.findById(line.orderId).select('status deliveredAt updatedAt').lean();
        if (!order || order.status !== ORDER_STATUS.DELIVERED) { waiting += 1; continue; }
        const deliveredAt = order.deliveredAt || order.updatedAt || now;
        line.deliveredAt = deliveredAt;
        line.eligibleAt = new Date(new Date(deliveredAt).getTime() + policy.returnWindowDays * 86400000);
        // eslint-disable-next-line no-await-in-loop
        await line.save();
        if (line.eligibleAt > now) { waiting += 1; continue; }
      }

      // Gate 2: has the money actually reached our bank?
      if (policy.requirePspSettlement) {
        // eslint-disable-next-line no-await-in-loop
        const settled = await LedgerJournal.exists({
          kind: LEDGER_JOURNAL_KIND.PSP_SETTLED, refType: 'order', refId: line.orderId,
        });
        if (!settled) { blocked += 1; continue; }
      }

      line.state = PAYOUT_LINE_STATE.ELIGIBLE;
      // eslint-disable-next-line no-await-in-loop
      await line.save();
      promoted += 1;
    }

    return { scanned: pending.length, promoted, waiting, blocked };
  }

  /**
   * A refund reverses the vendor's entitlement. If the original line has not
   * been paid yet it flips to REVERSED and never enters a batch; if it has,
   * a NEGATIVE line is created that reduces the vendor's next cycle (and can
   * push it negative, which the carry-forward rule then handles).
   */
  async reverseForRefund({ refundTransaction, creditNoteId = null }) {
    const rt = refundTransaction;
    const lines = await PayoutLineItem.find({
      orderId: rt.orderId, reversalOfLineId: null,
    });
    if (!lines.length) return { reversed: 0, clawedBack: 0 };

    const refundPaise = toPaise(rt.amount);
    const orderGross = sumPaise(...lines.map((l) => l.grossPaise));
    if (orderGross <= 0) return { reversed: 0, clawedBack: 0 };

    // proportional to each vendor line's share of the order's vendor value
    const { allocatePaise } = await import('../utils/money.js');
    const shares = allocatePaise(Math.min(refundPaise, orderGross), lines.map((l) => l.grossPaise));

    let reversed = 0;
    let clawedBack = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const share = shares[i];
      if (share <= 0) continue;
      const ratio = share / line.grossPaise;

      if ([PAYOUT_LINE_STATE.ACCRUED, PAYOUT_LINE_STATE.ELIGIBLE, PAYOUT_LINE_STATE.HELD].includes(line.state)) {
        // not paid yet → simply cancel the entitlement
        line.state = PAYOUT_LINE_STATE.REVERSED;
        line.refundTransactionId = rt._id;
        line.creditNoteId = creditNoteId;
        // eslint-disable-next-line no-await-in-loop
        await line.save();
        reversed += 1;
      } else {
        // already batched or paid → book a negative line for the next cycle
        // eslint-disable-next-line no-await-in-loop
        await PayoutLineItem.create({
          vendorId: line.vendorId,
          tenantId: line.tenantId,
          orderId: line.orderId,
          orderItemId: null,
          orderNumber: line.orderNumber,
          grossPaise: -Math.round(line.grossPaise * ratio),
          taxableValuePaise: -Math.round(line.taxableValuePaise * ratio),
          sellerGstPaise: -Math.round(line.sellerGstPaise * ratio),
          commissionRateBps: line.commissionRateBps,
          commissionPaise: -Math.round(line.commissionPaise * ratio),
          gstOnCommissionPaise: -Math.round(line.gstOnCommissionPaise * ratio),
          tcsRateBps: line.tcsRateBps,
          tcsPaise: -Math.round(line.tcsPaise * ratio),
          tdsRateBps: line.tdsRateBps,
          tdsPaise: -Math.round(line.tdsPaise * ratio),
          netPayablePaise: -Math.round(line.netPayablePaise * ratio),
          state: PAYOUT_LINE_STATE.ELIGIBLE, // immediately offsets the next cycle
          eligibleAt: new Date(),
          reversalOfLineId: line._id,
          refundTransactionId: rt._id,
          creditNoteId,
        });
        clawedBack += 1;
      }
    }

    return { reversed, clawedBack };
  }

  /** Block or release specific lines (dispute, KYC, fraud review). */
  async holdLines({ lineIds = [], vendorId = null, reason = PAYOUT_HOLD_REASON.MANUAL, note = null, actorId = null, req = null }) {
    const q = lineIds.length
      ? { _id: { $in: lineIds.map(toId) } }
      : { vendorId: toId(vendorId), state: { $in: [PAYOUT_LINE_STATE.ACCRUED, PAYOUT_LINE_STATE.ELIGIBLE] } };
    const res = await PayoutLineItem.updateMany(q, {
      $set: { state: PAYOUT_LINE_STATE.HELD, holdReason: reason, holdNote: note },
    });
    await auditService.record({
      action: AUDIT_ACTION.PAYOUT_HOLD, entityType: 'payout_line', entityId: toId(vendorId) || toId(lineIds[0]),
      actorId, actorType: 'admin', after: { reason, note, matched: res.modifiedCount }, req,
    }).catch(() => {});
    return { held: res.modifiedCount };
  }

  async releaseLines({ lineIds = [], actorId = null, req = null }) {
    const res = await PayoutLineItem.updateMany(
      { _id: { $in: lineIds.map(toId) }, state: PAYOUT_LINE_STATE.HELD },
      { $set: { state: PAYOUT_LINE_STATE.ELIGIBLE, holdReason: null, holdNote: null } }
    );
    await auditService.record({
      action: AUDIT_ACTION.PAYOUT_HOLD, entityType: 'payout_line', entityId: toId(lineIds[0]),
      actorId, actorType: 'admin', after: { released: res.modifiedCount }, req,
    }).catch(() => {});
    return { released: res.modifiedCount };
  }

  // -------------------------------------------------------------------------
  // cycle computation
  // -------------------------------------------------------------------------

  /** PO-{YYMM}-{seq}, atomic like the invoice numbering. */
  async nextBatchNumber() {
    const stamp = new Date().toISOString().slice(2, 7).replace('-', '');
    const doc = await Counter.findOneAndUpdate(
      { key: `payout:${stamp}` },
      { $inc: { value: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return `PO-${stamp}-${String(doc.value).padStart(6, '0')}`;
  }

  /**
   * Build (or return) the batch for one vendor and one cycle.
   *
   * Idempotent on (vendorId, cycle) via a unique index AND a unique
   * idempotencyKey — recomputing a cycle can never produce a second batch,
   * which is the difference between a retry and a double payment.
   */
  async computeCycleForVendor({ vendorId, from, to, actorId = null, req = null }) {
    const cycleFrom = new Date(from);
    const cycleTo = new Date(to);
    const idempotencyKey = `payout:${vendorId}:${cycleFrom.toISOString().slice(0, 10)}:${cycleTo.toISOString().slice(0, 10)}`;

    const existing = await PayoutBatch.findOne({ idempotencyKey });
    if (existing) return { batch: existing, created: false };

    const policy = await this.resolvePolicy({ vendorId });

    // eligible lines whose window closed inside this cycle
    const lines = await PayoutLineItem.find({
      vendorId: toId(vendorId),
      state: PAYOUT_LINE_STATE.ELIGIBLE,
      eligibleAt: { $gte: cycleFrom, $lt: cycleTo },
    });

    const adjustments = await PayoutAdjustment.find({ vendorId: toId(vendorId), appliedInBatchId: null });
    const carried = await PayoutBatch.findOne({
      vendorId: toId(vendorId), carryForwardPaise: { $ne: 0 },
    }).sort({ 'cycle.to': -1 }).lean();

    const openingBalancePaise = carried?.carryForwardPaise || 0;
    const adjustmentsPaise = sumPaise(...adjustments.map((a) => a.amountPaise));

    if (!lines.length && adjustmentsPaise === 0 && openingBalancePaise === 0) {
      return { batch: null, created: false, reason: 'NOTHING_TO_PAY' };
    }

    const totals = {
      grossPaise: sumPaise(...lines.map((l) => l.grossPaise)),
      sellerGstPaise: sumPaise(...lines.map((l) => l.sellerGstPaise)),
      commissionPaise: sumPaise(...lines.map((l) => l.commissionPaise)),
      gstOnCommissionPaise: sumPaise(...lines.map((l) => l.gstOnCommissionPaise)),
      tcsPaise: sumPaise(...lines.map((l) => l.tcsPaise)),
      tdsPaise: sumPaise(...lines.map((l) => l.tdsPaise)),
    };
    const linesNet = sumPaise(...lines.map((l) => l.netPayablePaise));
    const rawNet = linesNet + adjustmentsPaise + openingBalancePaise;

    // ---- floor & negative-balance rules ----
    let netPaise = rawNet;
    let carryForwardPaise = 0;
    if (rawNet < 0) {
      if (!policy.negativeBalanceCarryForward) {
        throw conflict('Vendor balance is negative and carry-forward is disabled', 'PAYOUT_NEGATIVE_BALANCE');
      }
      netPaise = 0;
      carryForwardPaise = rawNet; // stays negative until future sales absorb it
    } else if (rawNet < policy.minPayoutPaise) {
      netPaise = 0;
      carryForwardPaise = rawNet; // below the floor — roll it forward
    }

    if (netPaise > policy.maxBatchPaise) {
      throw conflict(
        `Batch of ₹${fromPaise(netPaise)} exceeds the ₹${fromPaise(policy.maxBatchPaise)} ceiling — split the cycle or raise the limit`,
        'PAYOUT_EXCEEDS_CEILING'
      );
    }

    const account = await VendorPayoutAccount.findOne({ vendorId: toId(vendorId), isDefault: true, status: 'active' });

    const batch = await PayoutBatch.create({
      batchNumber: await this.nextBatchNumber(),
      vendorId: toId(vendorId),
      tenantId: lines[0]?.tenantId || null,
      cycle: { from: cycleFrom, to: cycleTo, label: `${cycleFrom.toISOString().slice(0, 10)}→${cycleTo.toISOString().slice(0, 10)}` },
      lineItemCount: lines.length,
      ...totals,
      adjustmentsPaise,
      openingBalancePaise,
      netPaise,
      carryForwardPaise,
      payoutAccount: account ? {
        accountId: account._id,
        method: account.method,
        maskedAccount: account.maskedAccount,
        ifsc: account.ifsc,
        vpa: account.vpa,
        holderName: account.accountHolderName,
        fingerprint: account.fingerprint,
      } : {},
      state: PAYOUT_STATE.DRAFT,
      idempotencyKey,
      requiresDualApproval: netPaise >= policy.dualApprovalPaise,
      initiatedBy: actorId,
    });

    // pin the lines and adjustments to this batch so nothing is ever counted twice
    if (lines.length) {
      await PayoutLineItem.updateMany(
        { _id: { $in: lines.map((l) => l._id) } },
        { $set: { state: PAYOUT_LINE_STATE.BATCHED, payoutBatchId: batch._id } }
      );
    }
    if (adjustments.length) {
      await PayoutAdjustment.updateMany(
        { _id: { $in: adjustments.map((a) => a._id) } },
        { $set: { appliedInBatchId: batch._id, appliedAt: new Date() } }
      );
    }

    await this.recordTransition(batch, null, PAYOUT_STATE.DRAFT, { actorId, note: 'computed' });
    await auditService.record({
      action: AUDIT_ACTION.PAYOUT_COMPUTE, entityType: 'payout_batch', entityId: batch._id,
      actorId, actorType: actorId ? 'admin' : 'system',
      after: { batchNumber: batch.batchNumber, net: fromPaise(netPaise), lines: lines.length }, req,
    }).catch(() => {});

    return { batch, created: true };
  }

  /** Run the cycle for every vendor with eligible money. */
  async computeCycle({ from, to, actorId = null, req = null }) {
    const vendorIds = await PayoutLineItem.distinct('vendorId', {
      state: PAYOUT_LINE_STATE.ELIGIBLE,
      eligibleAt: { $gte: new Date(from), $lt: new Date(to) },
    });

    const results = [];
    for (const vendorId of vendorIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await this.computeCycleForVendor({ vendorId, from, to, actorId, req });
        results.push({ vendorId: String(vendorId), created: r.created, batchNumber: r.batch?.batchNumber, net: r.batch ? fromPaise(r.batch.netPaise) : 0, reason: r.reason });
      } catch (err) {
        results.push({ vendorId: String(vendorId), error: err.message, code: err.code });
      }
    }
    return {
      vendors: vendorIds.length,
      created: results.filter((r) => r.created).length,
      skipped: results.filter((r) => !r.created && !r.error).length,
      failed: results.filter((r) => r.error).length,
      results,
    };
  }

  // -------------------------------------------------------------------------
  // state transitions
  // -------------------------------------------------------------------------

  async recordTransition(batch, fromState, toState, { actorId = null, actorType = AUDIT_ACTOR_TYPE.SYSTEM, note = null, meta = null } = {}) {
    await PayoutStatusHistory.create({
      payoutBatchId: batch._id,
      vendorId: batch.vendorId,
      fromState,
      toState,
      actorId,
      actorType,
      note,
      meta,
    });
  }

  async transition(batch, toState, { actorId = null, actorType = AUDIT_ACTOR_TYPE.ADMIN, note = null, meta = null } = {}) {
    const from = batch.state;
    assertTransition(from, toState);
    batch.state = toState;
    await batch.save();
    await this.recordTransition(batch, from, toState, { actorId, actorType, note, meta });
    return batch;
  }

  async submitForApproval({ batchId, actorId = null, req = null }) {
    const batch = await this.getBatch(batchId);
    if (batch.netPaise <= 0) {
      throw conflict('Nothing to pay in this batch — it carries forward instead', 'PAYOUT_NOTHING_TO_PAY');
    }
    await this.assertPayable(batch);
    await this.transition(batch, PAYOUT_STATE.PENDING_APPROVAL, { actorId, note: 'submitted for approval' });
    return batch;
  }

  /**
   * Approve. Dual approval is enforced by counting DISTINCT approvers — the
   * same person clicking twice is not two approvals.
   */
  async approve({ batchId, actorId, note = null, req = null }) {
    const batch = await this.getBatch(batchId);
    if (batch.state !== PAYOUT_STATE.PENDING_APPROVAL) {
      throw conflict(`Batch is ${batch.state} — only a pending batch can be approved`, 'PAYOUT_NOT_PENDING');
    }
    await this.assertPayable(batch);

    const already = batch.approvals.some((a) => String(a.userId) === String(actorId));
    if (already) throw conflict('You have already approved this batch', 'PAYOUT_ALREADY_APPROVED_BY_YOU');

    batch.approvals.push({ userId: toId(actorId), at: new Date(), note });
    await batch.save();

    const needed = batch.requiresDualApproval ? 2 : 1;
    if (batch.approvals.length >= needed) {
      await this.transition(batch, PAYOUT_STATE.APPROVED, { actorId, note: `approved by ${batch.approvals.length}` });
    }

    await auditService.record({
      action: AUDIT_ACTION.PAYOUT_APPROVE, entityType: 'payout_batch', entityId: batch._id,
      actorId, actorType: 'admin',
      after: { batchNumber: batch.batchNumber, net: fromPaise(batch.netPaise), approvals: batch.approvals.length, state: batch.state }, req,
    }).catch(() => {});

    return { batch, approvals: batch.approvals.length, needed };
  }

  async reject({ batchId, reason, actorId = null, req = null }) {
    const batch = await this.getBatch(batchId);
    await this.transition(batch, PAYOUT_STATE.REJECTED, { actorId, note: reason });
    await auditService.record({
      action: AUDIT_ACTION.PAYOUT_REJECT, entityType: 'payout_batch', entityId: batch._id,
      actorId, actorType: 'admin', after: { reason }, req,
    }).catch(() => {});
    return batch;
  }

  /**
   * Cancel a batch and RELEASE its lines back to ELIGIBLE so they are picked up
   * by a later cycle. Refuses once the batch is in flight — at that point only
   * reconciliation may decide.
   */
  async cancel({ batchId, reason, actorId = null, req = null }) {
    const batch = await this.getBatch(batchId);
    if (PAYOUT_IN_FLIGHT.includes(batch.state)) {
      throw conflict('This batch is with the payment provider — it can only be resolved by reconciliation', 'PAYOUT_IN_FLIGHT');
    }
    await this.transition(batch, PAYOUT_STATE.CANCELLED, { actorId, note: reason });
    await this.releaseBatchLines(batch);
    return batch;
  }

  async releaseBatchLines(batch) {
    await PayoutLineItem.updateMany(
      { payoutBatchId: batch._id, state: PAYOUT_LINE_STATE.BATCHED },
      { $set: { state: PAYOUT_LINE_STATE.ELIGIBLE, payoutBatchId: null } }
    );
    await PayoutAdjustment.updateMany(
      { appliedInBatchId: batch._id },
      { $set: { appliedInBatchId: null, appliedAt: null } }
    );
  }

  /** Every safety rail that must hold before money can move. */
  async assertPayable(batch) {
    const account = batch.payoutAccount?.accountId
      ? await VendorPayoutAccount.findById(batch.payoutAccount.accountId)
      : await VendorPayoutAccount.findOne({ vendorId: batch.vendorId, isDefault: true, status: 'active' });

    if (!account) {
      throw new AppError('Vendor has no active payout account', { status: 403, code: 'PAYOUT_NO_ACCOUNT' });
    }
    if (account.kyc?.status !== 'approved') {
      throw new AppError('Vendor KYC is not approved', { status: 403, code: 'PAYOUT_KYC_REQUIRED', details: { kyc: account.kyc?.status } });
    }
    if (account.verification?.status !== 'verified') {
      throw new AppError('Vendor bank account is not verified', { status: 403, code: 'PAYOUT_BANK_UNVERIFIED' });
    }
    if (account.frozenUntil && account.frozenUntil > new Date()) {
      throw new AppError(
        `Payouts are frozen until ${account.frozenUntil.toISOString()} after a bank-detail change`,
        { status: 403, code: 'PAYOUT_ACCOUNT_FROZEN', details: { frozenUntil: account.frozenUntil } }
      );
    }
    // the destination must still be the one that was approved
    if (batch.payoutAccount?.fingerprint && account.fingerprint
      && batch.payoutAccount.fingerprint !== account.fingerprint) {
      throw new AppError(
        'The vendor bank account changed after this batch was computed — recompute it',
        { status: 409, code: 'PAYOUT_ACCOUNT_CHANGED' }
      );
    }
    return account;
  }

  // -------------------------------------------------------------------------
  // ledger
  // -------------------------------------------------------------------------

  /**
   * Post `payout_initiated`. Drains the vendor's payable AND the GST held on
   * their behalf, books the statutory liabilities, and credits the bank.
   */
  async postPayoutJournal(batch) {
    const v = batch.vendorId;
    const drainPayable = batch.grossPaise - batch.sellerGstPaise - batch.commissionPaise
      + batch.adjustmentsPaise + batch.openingBalancePaise;

    const lines = [
      { accountCode: ledgerAccounts.vendorPayable(v), debitPaise: Math.max(0, drainPayable) },
      { accountCode: ledgerAccounts.gstOutputPayable(v), debitPaise: Math.max(0, batch.sellerGstPaise) },
      { accountCode: ledgerAccounts.bank(), creditPaise: batch.netPaise },
      { accountCode: ledgerAccounts.gstOutputPayable('platform'), creditPaise: batch.gstOnCommissionPaise },
      { accountCode: ledgerAccounts.tcsPayable(), creditPaise: batch.tcsPaise },
      { accountCode: ledgerAccounts.tdsPayable(), creditPaise: batch.tdsPaise },
    ].filter((l) => (l.debitPaise || 0) !== 0 || (l.creditPaise || 0) !== 0);

    // any residue (carry-forward, rounding) parks on the clawback account so
    // the journal balances and the difference stays visible
    const debits = sumPaise(...lines.map((l) => l.debitPaise || 0));
    const credits = sumPaise(...lines.map((l) => l.creditPaise || 0));
    const diff = debits - credits;
    if (diff !== 0) {
      lines.push({
        accountCode: ledgerAccounts.refundClawback(v),
        ...(diff > 0 ? { creditPaise: diff } : { debitPaise: -diff }),
        memo: 'carry-forward / residue',
      });
    }

    return ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.PAYOUT_INITIATED,
      idempotencyKey: `${LEDGER_JOURNAL_KIND.PAYOUT_INITIATED}:payout_batch:${batch._id}`,
      lines,
      refType: 'payout_batch',
      refId: batch._id,
      tenantId: batch.tenantId,
      vendorId: batch.vendorId,
      meta: { batchNumber: batch.batchNumber },
    });
  }

  // -------------------------------------------------------------------------
  // disbursement (M5) — where money actually leaves
  // -------------------------------------------------------------------------

  /**
   * Hand an APPROVED batch to the payment provider.
   *
   * The ordering here is deliberate and is the whole safety design:
   *   1. re-check every rail (`assertPayable`) — approval may be hours old
   *   2. move to QUEUED → PROCESSING BEFORE calling the provider, so a crash
   *      mid-call leaves a batch that reconciliation will chase, not one that
   *      looks un-submitted and invites a second submission
   *   3. post the ledger journal (vendor_payable → bank) at submission, since
   *      the liability is discharged the moment the instruction is accepted
   *   4. on an AMBIGUOUS result, stop. Do not retry, do not fail it. Flag
   *      `needsReconciliation` and let the sweep ask the provider.
   */
  async submit({ batchId, actorId = null, req = null }) {
    const batch = await this.getBatch(batchId);
    if (batch.state !== PAYOUT_STATE.APPROVED && batch.state !== PAYOUT_STATE.FAILED) {
      throw conflict(`Batch is ${batch.state} — only an approved or failed batch can be submitted`, 'PAYOUT_NOT_SUBMITTABLE');
    }

    const account = await this.assertPayable(batch);

    if (batch.state === PAYOUT_STATE.FAILED) {
      // a clean provider rejection is the ONLY retryable failure
      await this.transition(batch, PAYOUT_STATE.QUEUED, { actorId, note: 'retry after provider rejection' });
    } else {
      await this.transition(batch, PAYOUT_STATE.QUEUED, { actorId, note: 'queued for disbursement' });
    }
    await this.transition(batch, PAYOUT_STATE.PROCESSING, { actorId, note: 'submitting to provider' });
    batch.submittedAt = new Date();
    await batch.save();

    // discharge the liability at submission time
    const journal = await this.postPayoutJournal(batch);
    if (journal?.journal) {
      batch.ledgerJournalIds = [...(batch.ledgerJournalIds || []), journal.journal._id];
      await batch.save();
    }

    const result = await payoutProvider.payout({
      idempotencyKey: batch.idempotencyKey,
      amountPaise: batch.netPaise,
      batchNumber: batch.batchNumber,
      account: {
        method: batch.payoutAccount?.method,
        maskedAccount: batch.payoutAccount?.maskedAccount,
        vpa: batch.payoutAccount?.vpa,
        ifsc: batch.payoutAccount?.ifsc,
        holderName: batch.payoutAccount?.holderName,
        accountNumber: account.accountNumberEnc
          ? Buffer.from(account.accountNumberEnc, 'base64').toString('utf8')
          : null,
        providerFundAccountId: account.providerRefs?.fundAccountId || null,
        providerBeneficiaryId: account.providerRefs?.beneficiaryId || null,
      },
    });

    batch.provider = result.provider;
    batch.transferMode = result.mode || null;
    batch.providerRef = result.providerRef || null;
    batch.providerStatus = result.status || null;

    if (result.ambiguous) {
      // ── THE CRITICAL BRANCH ──
      // We do not know whether money moved. Stay PROCESSING, flag for
      // reconciliation, and never retry. A retry here is how a marketplace
      // pays the same vendor twice.
      batch.needsReconciliation = true;
      batch.failureReason = result.error || 'ambiguous provider response';
      await batch.save();
      await this.recordTransition(batch, PAYOUT_STATE.PROCESSING, PAYOUT_STATE.PROCESSING, {
        actorId, note: `AMBIGUOUS: ${batch.failureReason} — awaiting reconciliation`,
      });
      await auditService.record({
        action: AUDIT_ACTION.PAYOUT_SUBMIT, entityType: 'payout_batch', entityId: batch._id,
        actorId, actorType: 'admin',
        after: { batchNumber: batch.batchNumber, outcome: 'ambiguous', error: batch.failureReason }, req,
      }).catch(() => {});
      return { batch, ambiguous: true };
    }

    if (!result.ok) {
      await this.markFailed({ batch, reason: result.error || 'provider rejected the payout', actorId });
      return { batch, failed: true, error: result.error };
    }

    batch.utr = result.utr || null;
    await batch.save();

    await auditService.record({
      action: AUDIT_ACTION.PAYOUT_SUBMIT, entityType: 'payout_batch', entityId: batch._id,
      actorId, actorType: 'admin',
      after: { batchNumber: batch.batchNumber, net: fromPaise(batch.netPaise), providerRef: batch.providerRef, mode: batch.transferMode }, req,
    }).catch(() => {});

    // console/mock settle synchronously; real providers confirm by webhook
    if (result.status === 'processed') {
      await this.markPaid({ batch, utr: result.utr, actorId });
    }

    return { batch, submitted: true, willReverse: Boolean(result.willReverse) };
  }

  /** Provider confirmed the transfer. Idempotent. */
  async markPaid({ batch, utr = null, actorId = null, req = null }) {
    if (batch.state === PAYOUT_STATE.PAID) return batch;
    await this.transition(batch, PAYOUT_STATE.PAID, { actorId, note: `settled${utr ? ` UTR ${utr}` : ''}` });
    batch.settledAt = new Date();
    batch.utr = utr || batch.utr;
    batch.needsReconciliation = false;
    batch.providerStatus = 'processed';
    await batch.save();

    await PayoutLineItem.updateMany(
      { payoutBatchId: batch._id, state: PAYOUT_LINE_STATE.BATCHED },
      { $set: { state: PAYOUT_LINE_STATE.PAID, paidAt: new Date() } }
    );

    await auditService.record({
      action: AUDIT_ACTION.PAYOUT_SETTLE, entityType: 'payout_batch', entityId: batch._id,
      actorId, actorType: actorId ? 'admin' : 'system',
      after: { batchNumber: batch.batchNumber, net: fromPaise(batch.netPaise), utr: batch.utr }, req,
    }).catch(() => {});
    return batch;
  }

  /**
   * The provider rejected the instruction BEFORE moving money.
   * The ledger journal posted at submission must therefore be undone, and the
   * lines released so a later cycle picks them up again.
   */
  async markFailed({ batch, reason, actorId = null, req = null }) {
    if (batch.state === PAYOUT_STATE.FAILED) return batch;
    await this.transition(batch, PAYOUT_STATE.FAILED, { actorId, note: reason });
    batch.failureReason = String(reason || '').slice(0, 400);
    batch.needsReconciliation = false;
    batch.providerStatus = 'failed';
    await batch.save();
    await this.unwindPayoutJournal(batch, 'payout rejected by provider');
    return batch;
  }

  /**
   * The bank returned the money AFTER a successful transfer (closed account,
   * wrong IFSC). The vendor's liability comes back and the lines return to the
   * eligible pool so the next cycle tries again.
   */
  async markReversed({ batch, reason, actorId = null, req = null }) {
    if (batch.state === PAYOUT_STATE.REVERSED) return batch;
    await this.transition(batch, PAYOUT_STATE.REVERSED, { actorId, note: reason || 'bank reversal' });
    batch.failureReason = String(reason || 'bank reversal').slice(0, 400);
    batch.needsReconciliation = false;
    batch.providerStatus = 'reversed';
    await batch.save();

    await this.unwindPayoutJournal(batch, 'bank reversed the payout');
    await PayoutLineItem.updateMany(
      { payoutBatchId: batch._id, state: { $in: [PAYOUT_LINE_STATE.BATCHED, PAYOUT_LINE_STATE.PAID] } },
      { $set: { state: PAYOUT_LINE_STATE.ELIGIBLE, payoutBatchId: null, paidAt: null } }
    );

    await auditService.record({
      action: AUDIT_ACTION.PAYOUT_REVERSE, entityType: 'payout_batch', entityId: batch._id,
      actorId, actorType: actorId ? 'admin' : 'system',
      after: { batchNumber: batch.batchNumber, reason: batch.failureReason }, req,
    }).catch(() => {});
    return batch;
  }

  /** Post the mirror image of the payout journal (money never left / came back). */
  async unwindPayoutJournal(batch, memo) {
    const key = `${LEDGER_JOURNAL_KIND.PAYOUT_INITIATED}:payout_batch:${batch._id}`;
    const original = await LedgerJournal.findOne({ idempotencyKey: key });
    if (!original) return null;

    const lines = original.lines.map((l) => ({
      accountCode: l.accountCode,
      debitPaise: l.creditPaise,   // mirror
      creditPaise: l.debitPaise,
      refType: l.refType,
      refId: l.refId,
      memo,
    }));

    const result = await ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.PAYOUT_REVERSED,
      idempotencyKey: `${LEDGER_JOURNAL_KIND.PAYOUT_REVERSED}:payout_batch:${batch._id}`,
      lines,
      refType: 'payout_batch',
      refId: batch._id,
      tenantId: batch.tenantId,
      vendorId: batch.vendorId,
      meta: { batchNumber: batch.batchNumber, reversalOf: String(original._id), memo },
    });
    if (result.created) {
      batch.ledgerJournalIds = [...(batch.ledgerJournalIds || []), result.journal._id];
      await batch.save();
    }
    return result;
  }

  /**
   * Apply a provider webhook. Idempotent by construction: each `mark*` is a
   * no-op when already in the target state, and an unknown reference is
   * reported rather than guessed at.
   */
  async applyProviderEvent({ idempotencyKey = null, providerRef = null, outcome, utr = null, failureReason = null, actorId = null }) {
    const q = idempotencyKey ? { idempotencyKey } : { providerRef };
    const batch = await PayoutBatch.findOne(q);
    if (!batch) return { matched: false, reason: 'no batch for this reference' };

    if (outcome === 'paid') await this.markPaid({ batch, utr, actorId });
    else if (outcome === 'failed') await this.markFailed({ batch, reason: failureReason || 'provider reported failure', actorId });
    else if (outcome === 'reversed') {
      // a reversal can arrive before we recorded the success
      if (batch.state === PAYOUT_STATE.PROCESSING) await this.markPaid({ batch, utr, actorId });
      await this.markReversed({ batch, reason: failureReason || 'bank reversal', actorId });
    } else return { matched: true, applied: false, reason: `unmapped outcome: ${outcome}` };

    return { matched: true, applied: true, batchNumber: batch.batchNumber, state: batch.state };
  }

  // -------------------------------------------------------------------------
  // reconciliation (M5) — the part everyone skips
  // -------------------------------------------------------------------------

  /**
   * Chase every batch stuck in PROCESSING: ask the provider what actually
   * happened, using our idempotency key as the lookup. This is the ONLY exit
   * from an ambiguous submission — hence no retry path anywhere in this method.
   */
  async reconcileInFlight({ olderThanMinutes = null, limit = 100 } = {}) {
    const cutoff = new Date(Date.now() - (olderThanMinutes ?? config.payouts.reconcileAfterMinutes) * 60000);
    const batches = await PayoutBatch.find({
      state: PAYOUT_STATE.PROCESSING,
      $or: [{ submittedAt: { $lte: cutoff } }, { needsReconciliation: true }],
    }).limit(limit);

    const out = { scanned: batches.length, resolvedPaid: 0, resolvedFailed: 0, resolvedReversed: 0, stillUnknown: 0 };

    for (const batch of batches) {
      // eslint-disable-next-line no-await-in-loop
      const found = await payoutProvider.fetchByIdempotencyKey({
        idempotencyKey: batch.idempotencyKey,
        amountPaise: batch.netPaise,
      });

      if (!found.found) { out.stillUnknown += 1; continue; }

      if (found.status === 'processed') {
        // eslint-disable-next-line no-await-in-loop
        await this.markPaid({ batch, utr: found.utr });
        out.resolvedPaid += 1;
      } else if (found.status === 'failed') {
        // eslint-disable-next-line no-await-in-loop
        await this.markFailed({ batch, reason: found.error || 'provider reported failure' });
        out.resolvedFailed += 1;
      } else if (found.status === 'reversed') {
        // eslint-disable-next-line no-await-in-loop
        await this.markPaid({ batch, utr: found.utr });
        // eslint-disable-next-line no-await-in-loop
        await this.markReversed({ batch, reason: 'provider reported reversal' });
        out.resolvedReversed += 1;
      } else {
        out.stillUnknown += 1;
      }
    }

    return out;
  }

  /**
   * Ingest a PSP settlement report and post `psp_settled` journals, moving
   * money from `gateway_clearing` into `bank`. This is what closes eligibility
   * gate 2 — until an order's cash is genuinely in our account, paying the
   * vendor for it is lending them our own money.
   *
   * @param {Array} rows [{ orderId | orderNumber, amount|amountPaise, settledAt, utr }]
   */
  async ingestPspSettlements({ rows = [], reference = null }) {
    const out = { rows: rows.length, posted: 0, skipped: 0, unmatched: [] };

    for (const row of rows) {
      const q = row.orderId ? { _id: toId(row.orderId) } : { orderNumber: row.orderNumber };
      // eslint-disable-next-line no-await-in-loop
      const order = await Order.findOne(q).select('_id orderNumber tenantId totalAmount').lean();
      if (!order) { out.unmatched.push(row.orderNumber || String(row.orderId)); continue; }

      const amountPaise = row.amountPaise ?? toPaise(row.amount ?? order.totalAmount);
      // eslint-disable-next-line no-await-in-loop
      const res = await ledgerService.post({
        kind: LEDGER_JOURNAL_KIND.PSP_SETTLED,
        idempotencyKey: `${LEDGER_JOURNAL_KIND.PSP_SETTLED}:order:${order._id}`,
        lines: [
          { accountCode: ledgerAccounts.bank(), debitPaise: amountPaise },
          { accountCode: ledgerAccounts.gatewayClearing(), creditPaise: amountPaise },
        ],
        refType: 'order',
        refId: order._id,
        tenantId: order.tenantId,
        occurredAt: row.settledAt ? new Date(row.settledAt) : new Date(),
        meta: { orderNumber: order.orderNumber, utr: row.utr || null, reference },
      });
      if (res.created) out.posted += 1; else out.skipped += 1;
    }

    return out;
  }

  // -------------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------------

  async getBatch(batchId, { vendorId = null } = {}) {
    const q = { _id: toId(batchId) };
    if (vendorId) q.vendorId = toId(vendorId);
    const batch = await PayoutBatch.findOne(q);
    if (!batch) throw notFound('Payout batch not found', 'PAYOUT_NOT_FOUND');
    return batch;
  }

  async listBatches({ vendorId = null, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = {};
    if (vendorId) q.vendorId = toId(vendorId);
    if (query.state) q.state = query.state;
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      PayoutBatch.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PayoutBatch.countDocuments(q),
    ]);
    return {
      items: serializeList(docs).map((d) => ({ ...d, net: fromPaise(d.netPaise) })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: skip + docs.length < total },
    };
  }

  /** A vendor's line-item statement for a batch — the anti-dispute document. */
  async statement({ batchId, vendorId = null }) {
    const batch = await this.getBatch(batchId, { vendorId });
    const lines = await PayoutLineItem.find({ payoutBatchId: batch._id }).lean();
    const adjustments = await PayoutAdjustment.find({ appliedInBatchId: batch._id }).lean();

    return {
      batch: {
        ...batch.toObject(),
        id: String(batch._id),
        rupees: {
          gross: fromPaise(batch.grossPaise),
          sellerGst: fromPaise(batch.sellerGstPaise),
          commission: fromPaise(batch.commissionPaise),
          gstOnCommission: fromPaise(batch.gstOnCommissionPaise),
          tcs: fromPaise(batch.tcsPaise),
          tds: fromPaise(batch.tdsPaise),
          adjustments: fromPaise(batch.adjustmentsPaise),
          openingBalance: fromPaise(batch.openingBalancePaise),
          net: fromPaise(batch.netPaise),
          carryForward: fromPaise(batch.carryForwardPaise),
        },
      },
      lines: serializeList(lines).map((l) => ({
        orderNumber: l.orderNumber,
        gross: fromPaise(l.grossPaise),
        taxableValue: fromPaise(l.taxableValuePaise),
        sellerGst: fromPaise(l.sellerGstPaise),
        commissionRatePct: l.commissionRateBps / 100,
        commission: fromPaise(l.commissionPaise),
        gstOnCommission: fromPaise(l.gstOnCommissionPaise),
        tcs: fromPaise(l.tcsPaise),
        tds: fromPaise(l.tdsPaise),
        netPayable: fromPaise(l.netPayablePaise),
        isReversal: Boolean(l.reversalOfLineId),
      })),
      adjustments: serializeList(adjustments).map((a) => ({
        reasonCode: a.reasonCode, note: a.note, amount: fromPaise(a.amountPaise),
      })),
    };
  }

  /** What a vendor can expect next cycle (eligible + still-accruing + held). */
  async upcoming({ vendorId }) {
    const [eligible, accrued, held] = await Promise.all([
      PayoutLineItem.aggregate([
        { $match: { vendorId: toId(vendorId), state: PAYOUT_LINE_STATE.ELIGIBLE } },
        { $group: { _id: null, net: { $sum: '$netPayablePaise' }, n: { $sum: 1 } } },
      ]),
      PayoutLineItem.aggregate([
        { $match: { vendorId: toId(vendorId), state: PAYOUT_LINE_STATE.ACCRUED } },
        { $group: { _id: null, net: { $sum: '$netPayablePaise' }, n: { $sum: 1 } } },
      ]),
      PayoutLineItem.aggregate([
        { $match: { vendorId: toId(vendorId), state: PAYOUT_LINE_STATE.HELD } },
        { $group: { _id: null, net: { $sum: '$netPayablePaise' }, n: { $sum: 1 } } },
      ]),
    ]);
    return {
      eligible: { amount: fromPaise(eligible[0]?.net || 0), lines: eligible[0]?.n || 0 },
      accruing: { amount: fromPaise(accrued[0]?.net || 0), lines: accrued[0]?.n || 0 },
      onHold: { amount: fromPaise(held[0]?.net || 0), lines: held[0]?.n || 0 },
    };
  }

  async addAdjustment({ vendorId, amountPaise, reasonCode, note = null, orderId = null, actorId = null, req = null }) {
    if (!Number.isFinite(amountPaise) || amountPaise === 0) {
      throw badRequest('Adjustment amount must be a non-zero integer in paise', 'INVALID_AMOUNT');
    }
    const doc = await PayoutAdjustment.create({
      vendorId: toId(vendorId), amountPaise: Math.round(amountPaise), reasonCode, note,
      orderId: toId(orderId), createdByUserId: toId(actorId),
    });
    await auditService.record({
      action: AUDIT_ACTION.PAYOUT_ADJUST, entityType: 'payout_adjustment', entityId: doc._id,
      actorId, actorType: 'admin',
      after: { vendorId: String(vendorId), amount: fromPaise(amountPaise), reasonCode, note }, req,
    }).catch(() => {});
    return doc;
  }
}

export default new PayoutService();
