import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import Vendor from '../models/vendor.model.js';
import Payment from '../models/payment.model.js';
import LedgerJournal from '../models/ledgerJournal.model.js';
import ledgerService, { ledgerAccounts } from './ledger.service.js';
import config from '../config/index.js';
import { AppError } from '../utils/ApiError.js';
import { toPaise, sumPaise, applyBps, fromPaise } from '../utils/money.js';
import {
  LEDGER_JOURNAL_KIND,
  ORDER_STATUS,
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
  REFUND_DESTINATION,
} from '../constants/enums.js';

/**
 * LedgerPostingService — translates BUSINESS EVENTS into ledger journals.
 *
 * `ledger.service.js` knows about debits and credits and nothing about flowers.
 * This service knows about orders, vendors and commission, and nothing about
 * how a journal is stored. Same separation as controller→service elsewhere in
 * the codebase.
 *
 * ── The sale journal ────────────────────────────────────────────────────────
 * When an order is CONFIRMED the customer's money is ours to distribute:
 *
 *   DR  gateway_clearing                      order.totalAmount
 *       CR  vendor_payable:{vendorId}         item net − commission     (vendor items)
 *       CR  platform_commission_income        commission                (vendor items)
 *       CR  tenant_payable:{tenantId}         item net                  (store's own items)
 *       CR  gst_output_payable:{sellerId}     item tax
 *       CR  tenant_payable:{tenantId}         delivery fee
 *
 * where `item net = lineTotal − discountAllocated` — the values PERSISTED on
 * OrderItem at order time by the Phase 3.5 pricing engine. Nothing is
 * recomputed from today's policy, which is what keeps historical journals
 * reproducible.
 *
 * ── Why store items don't accrue commission here ────────────────────────────
 * A store selling its OWN inventory is billed monthly by the Phase 5 billing
 * cycle (`Invoice` = subscription fee + commission on GMV). Accruing commission
 * per order as well would double-count it. Vendor items are different: the
 * platform deducts commission at source before paying the vendor, so it must
 * be recognised at sale time. This asymmetry is deliberate and is the reason
 * `resolveCommissionBps()` returns 0 for non-vendor lines.
 *
 * ── Float → paise boundary ──────────────────────────────────────────────────
 * Legacy order values are rupee floats. Each is converted with `toPaise()` and
 * the journal is balanced against `order.totalAmount`. Sub-paisa artefacts from
 * the legacy float pipeline land on `rounding_difference` (bounded and asserted)
 * so the journal always balances AND the drift stays measurable.
 */

/** Max acceptable float-artefact drift before we treat it as a real bug. */
const ROUNDING_TOLERANCE_PAISE = 100; // ₹1 across a whole order

class LedgerPostingService {
  /** Vendor commission rate (bps). 0 for store-owned lines — see header note. */
  async resolveCommissionBps({ vendorId, vendorCache }) {
    if (!vendorId) return 0;
    const key = String(vendorId);
    if (vendorCache?.has(key)) return vendorCache.get(key);
    const vendor = await Vendor.findById(vendorId).select('commissionRateBps').lean();
    const bps = vendor?.commissionRateBps ?? config.marketplace.defaultCommissionBps;
    vendorCache?.set(key, bps);
    return bps;
  }

  /**
   * Build (but do not post) the sale journal lines for an order.
   *
   * Exposed separately so the money maths can be asserted without a database:
   * pass a pre-populated `vendorCache` (Map of vendorId -> commissionRateBps)
   * and no query is issued. `scripts/money.test.js` uses exactly that.
   */
  async buildSaleLines({ order, items, vendorCache = new Map(), isWalletPayment = false }) {
    const tenantId = order.tenantId;
    const lines = [];

    for (const item of items) {
      const lineTotalPaise = toPaise(item.lineTotal ?? 0);
      const discountPaise = toPaise(item.discountAllocated ?? 0);
      const taxPaise = toPaise(item.taxAmount ?? 0);
      const netPaise = lineTotalPaise - discountPaise;

      if (netPaise < 0) {
        throw new AppError(
          `Order item ${item._id} has a discount larger than its line total`,
          { status: 422, code: 'LEDGER_NEGATIVE_LINE', details: { orderItemId: String(item._id) } }
        );
      }

      const sellerOwnerId = item.vendorId ? String(item.vendorId) : String(tenantId);
      const bps = await this.resolveCommissionBps({ vendorId: item.vendorId, vendorCache });
      const commissionPaise = applyBps(netPaise, bps);
      const sellerNetPaise = netPaise - commissionPaise;

      if (item.vendorId) {
        lines.push({
          accountCode: ledgerAccounts.vendorPayable(item.vendorId),
          creditPaise: sellerNetPaise,
          refType: 'order_item',
          refId: item._id,
          memo: item.skuSnapshot?.title || 'item',
        });
        if (commissionPaise > 0) {
          lines.push({
            accountCode: ledgerAccounts.commissionIncome(),
            creditPaise: commissionPaise,
            refType: 'order_item',
            refId: item._id,
            memo: `commission ${bps / 100}%`,
          });
        }
      } else {
        lines.push({
          accountCode: ledgerAccounts.tenantPayable(tenantId),
          creditPaise: sellerNetPaise,
          refType: 'order_item',
          refId: item._id,
          memo: item.skuSnapshot?.title || 'item',
        });
      }

      if (taxPaise > 0) {
        lines.push({
          accountCode: ledgerAccounts.gstOutputPayable(sellerOwnerId),
          creditPaise: taxPaise,
          refType: 'order_item',
          refId: item._id,
          memo: `GST${item.hsnCode ? ` HSN ${item.hsnCode}` : ''}`,
        });
      }
    }

    // delivery fee is the store's revenue (it fulfils the delivery)
    const deliveryFeePaise = toPaise(order.deliveryFee ?? 0);
    if (deliveryFeePaise > 0) {
      lines.push({
        accountCode: ledgerAccounts.tenantPayable(tenantId),
        creditPaise: deliveryFeePaise,
        refType: 'order',
        refId: order._id,
        memo: 'delivery fee',
      });
    }

    // ---- balance against what the customer actually paid ----
    const totalPaise = toPaise(order.totalAmount ?? 0);
    const creditsPaise = sumPaise(...lines.map((l) => l.creditPaise || 0));
    const diff = totalPaise - creditsPaise;

    if (diff !== 0) {
      if (Math.abs(diff) > ROUNDING_TOLERANCE_PAISE) {
        throw new AppError(
          `Order total (${fromPaise(totalPaise)}) does not match the sum of its parts (${fromPaise(creditsPaise)})`,
          {
            status: 422,
            code: 'LEDGER_ORDER_TOTAL_MISMATCH',
            details: { orderId: String(order._id), totalPaise, creditsPaise, diffPaise: diff },
          }
        );
      }
      // Legacy float artefact: park it, visibly, on the rounding account.
      lines.push({
        accountCode: ledgerAccounts.roundingDifference(),
        ...(diff > 0 ? { creditPaise: diff } : { debitPaise: -diff }),
        refType: 'order',
        refId: order._id,
        memo: 'rounding difference (legacy float pipeline)',
      });
    }

    // Where did the customer's money come from? A gateway charge lands in
    // `gateway_clearing` (we hold it before distributing); a wallet payment
    // reduces the `customer_wallet_liability` we already owed them. Using the
    // wrong account would make a wallet refund impossible to reconcile.
    lines.unshift({
      accountCode: isWalletPayment ? ledgerAccounts.walletLiability() : ledgerAccounts.gatewayClearing(),
      debitPaise: totalPaise,
      refType: 'order',
      refId: order._id,
      memo: `order ${order.orderNumber} (${isWalletPayment ? 'wallet' : order.paymentMethod || 'gateway'})`,
    });

    return { lines, totalPaise };
  }

  /**
   * Post `sale_captured` for a confirmed order. Idempotent on the order id, so
   * a webhook replay, a saga retry or the backfill sweep all converge.
   */
  async postSaleCaptured({ order, items = null, postedBy = null }) {
    const orderItems = items || await OrderItem.find({ orderId: order._id }).lean();
    if (!orderItems.length) {
      throw new AppError('Cannot post a sale journal for an order with no items', {
        status: 422, code: 'LEDGER_NO_ITEMS', details: { orderId: String(order._id) },
      });
    }

    // Decide the source account from the PAYMENT (the money movement truth),
    // not the order's method hint. A wallet payment debits customer_wallet_
    // liability; everything else debits gateway_clearing.
    const payment = order.paymentSummary?.paymentId
      ? await Payment.findById(order.paymentSummary.paymentId).lean()
      : null;
    const isWalletPayment = Boolean(
      payment
        && (payment.provider === PAYMENT_PROVIDER.WALLET || payment.method === PAYMENT_METHOD.WALLET)
    );

    const { lines } = await this.buildSaleLines({ order, items: orderItems, isWalletPayment });

    return ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.SALE_CAPTURED,
      idempotencyKey: this.saleKey(order._id),
      lines,
      refType: 'order',
      refId: order._id,
      tenantId: order.tenantId,
      occurredAt: order.paymentSummary?.paidAt || new Date(),
      postedBy,
      meta: { orderNumber: order.orderNumber, paymentMethod: order.paymentMethod },
    });
  }

  /**
   * Post `refund_issued` by reversing a proportional slice of the sale journal.
   *
   * We deliberately do NOT recompute which accounts to touch: we reverse what
   * the sale actually credited. A refund can therefore never touch a vendor who
   * wasn't on the order, and can never exceed what was captured.
   */
  async postRefund({ refundTransaction }) {
    const rt = refundTransaction;
    const counter = rt.destination === REFUND_DESTINATION.WALLET
      ? ledgerAccounts.walletLiability()   // we still owe the money — as wallet balance
      : ledgerAccounts.gatewayClearing();  // money goes back out through the gateway

    return ledgerService.reverseProportional({
      originalKey: this.saleKey(rt.orderId),
      amountPaise: toPaise(rt.amount),
      counterAccount: counter,
      kind: LEDGER_JOURNAL_KIND.REFUND_ISSUED,
      idempotencyKey: `${LEDGER_JOURNAL_KIND.REFUND_ISSUED}:refund:${rt._id}`,
      refType: 'refund',
      refId: rt._id,
      occurredAt: rt.completedAt || new Date(),
      memo: `refund ${rt.reason}`,
    });
  }

  /** Canonical idempotency key for an order's sale journal. */
  saleKey(orderId) {
    return `${LEDGER_JOURNAL_KIND.SALE_CAPTURED}:order:${orderId}`;
  }

  /**
   * Backfill sweep — post sale journals for orders that reached CONFIRMED
   * without one (ledger introduced after the order, or a crash between the
   * saga step and the post). Idempotent, resumable, safe to run nightly.
   */
  async backfillSales({ from = null, to = null, limit = 500, tenantId = null } = {}) {
    const q = {
      status: { $nin: [ORDER_STATUS.CREATED, ORDER_STATUS.PAYMENT_PENDING] },
      isDeleted: { $ne: true },
    };
    if (tenantId) q.tenantId = tenantId;
    if (from || to) {
      q.createdAt = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      };
    }

    const orders = await Order.find(q).sort({ createdAt: 1 }).limit(limit);
    let posted = 0;
    let skipped = 0;
    const failures = [];

    for (const order of orders) {
      const key = this.saleKey(order._id);
      // eslint-disable-next-line no-await-in-loop
      const exists = await LedgerJournal.exists({ idempotencyKey: key });
      if (exists) { skipped += 1; continue; }
      try {
        // eslint-disable-next-line no-await-in-loop
        const { created } = await this.postSaleCaptured({ order });
        if (created) posted += 1; else skipped += 1;
      } catch (err) {
        failures.push({ orderId: String(order._id), orderNumber: order.orderNumber, error: err.message, code: err.code });
      }
    }

    return { scanned: orders.length, posted, skipped, failures };
  }

  /**
   * Fire-and-observe wrapper used by the order saga.
   *
   * Money posting must never be the reason a paid order fails to confirm: the
   * customer has already been charged and the stock already committed. So in
   * non-strict mode a failure is logged and left to `backfillSales()` (posting
   * is idempotent, so re-posting later is exact). In strict mode (production
   * default) the error propagates.
   */
  async safePost(label, fn) {
    try {
      return await fn();
    } catch (err) {
      if (config.ledger.strict) throw err;
      // eslint-disable-next-line no-console
      console.error(`[ledger] ${label} failed (non-strict, will be backfilled):`, err.code || '', err.message);
      return { journal: null, created: false, error: err };
    }
  }
}

export default new LedgerPostingService();
