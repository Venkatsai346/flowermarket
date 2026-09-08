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

// ---------------------------------------------------------------------------
// PURE source-account resolution — exported so scripts/cod-ledger.test.js can
// prove which account a sale debits WITHOUT a database. This is the decision
// that keeps the books honest: an account is only meaningful if the same kind
// of money always lands in it.
// ---------------------------------------------------------------------------

/**
 * Which asset account holds the customer's money for a captured sale?
 *
 *   wallet → customer_wallet_liability  we already owed them; the balance drops
 *   COD    → cod_receivable             NOBODY holds it yet — a rider must go
 *                                       and get it. Booking this to
 *                                       gateway_clearing would claim a PSP is
 *                                       holding cash it has never seen.
 *   else   → gateway_clearing           the PSP holds it pending settlement
 *
 * Wallet wins over COD if both flags are somehow set: a wallet balance is real
 * money already in the building, and treating it as uncollected cash would
 * understate assets.
 */
export function saleSourceAccount({ isWalletPayment = false, isCodPayment = false } = {}) {
  if (isWalletPayment) {
    return { accountCode: ledgerAccounts.walletLiability(), label: 'wallet', kind: 'wallet' };
  }
  if (isCodPayment) {
    return { accountCode: ledgerAccounts.codReceivable(), label: 'cash on delivery', kind: 'cod' };
  }
  return { accountCode: ledgerAccounts.gatewayClearing(), label: 'gateway', kind: 'gateway' };
}

/**
 * Did this order's money come from cash?
 *
 * Resolved from the PAYMENT row (the money-movement truth), falling back to the
 * order's method hint only for legacy rows predating the provider stamp.
 * PURE: plain objects in, boolean out.
 */
export function isCodPayment(payment, order = null) {
  if (payment) {
    // A COD payment is stamped provider=cod at creation, so that settles it.
    if (payment.provider === PAYMENT_PROVIDER.COD) return true;
    // Any OTHER named provider is authoritative and means "a real rail moved
    // this money" — wallet, razorpay or the mock gateway. The order's method
    // hint must NOT be allowed to override it: an order that says `cod` but has
    // a razorpay payment against it was prepaid, and treating it as cash would
    // book a receivable for money already in the building (and let the payout
    // settlement gate pass on a `cod_collected` that never happened).
    if (payment.provider) return false;
    // No provider recorded (legacy rows): fall back to the method.
    if (payment.method === PAYMENT_METHOD.COD) return true;
    if (payment.method) return false;
  }
  // No payment at all — the order's hint is all there is.
  return order?.paymentMethod === PAYMENT_METHOD.COD;
}

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
  async buildSaleLines({ order, items, vendorCache = new Map(), isWalletPayment = false, isCodPayment = false }) {
    const tenantId = order.tenantId;
    const lines = [];
    // Inclusive MRP: total === items − discount + fee (tax is inside the shelf).
    // Exclusive (legacy / money.test.js): total === items + tax − discount + fee.
    // Infer from the order itself so we never re-price and never break historical journals.
    const inclusiveIdentity = toPaise(order.totalAmount ?? 0)
      === toPaise(order.itemsSubtotal ?? 0) - toPaise(order.discount ?? 0) + toPaise(order.deliveryFee ?? 0);

    for (const item of items) {
      const lineTotalPaise = toPaise(item.lineTotal ?? 0);
      const discountPaise = toPaise(item.discountAllocated ?? 0);
      const taxPaise = toPaise(item.taxAmount ?? 0);
      const netPaise = inclusiveIdentity ? (lineTotalPaise - discountPaise - taxPaise) : (lineTotalPaise - discountPaise);

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

    // Where did the customer's money come from? Three honest answers, and
    // picking the wrong one makes the account meaningless:
    //   gateway → `gateway_clearing`, money the PSP holds for us
    //   wallet  → `customer_wallet_liability`, money we already owed them
    //   COD     → `cod_receivable`, money NOBODY holds yet: the customer owes
    //             it and a rider has not collected. Booking a COD sale to
    //             gateway_clearing would assert a PSP is holding cash it has
    //             never seen — and that phantom balance is precisely what
    //             makes the settlement reconciliation disagree.
    const source = saleSourceAccount({ isWalletPayment, isCodPayment });
    lines.unshift({
      accountCode: source.accountCode,
      debitPaise: totalPaise,
      refType: 'order',
      refId: order._id,
      memo: `order ${order.orderNumber} (${source.label})`,
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
    // COD is a third source account, not a flavour of gateway. Wallet wins if
    // both somehow appear (a wallet is real money we hold; COD is a promise).
    const isCodPayment = !isWalletPayment && isCodPayment(payment, order);

    const { lines } = await this.buildSaleLines({ order, items: orderItems, isWalletPayment, isCodPayment });

    return ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.SALE_CAPTURED,
      idempotencyKey: this.saleKey(order._id),
      lines,
      refType: 'order',
      refId: order._id,
      tenantId: order.tenantId,
      occurredAt: order.paymentSummary?.paidAt || new Date(),
      postedBy,
      traceId: order.traceId || null,
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
  async postRefund({ refundTransaction, isCodPayment = null }) {
    const rt = refundTransaction;
    // Where the money goes BACK OUT of must match where it came IN from:
    //   wallet destination → we still owe it, as wallet balance
    //   COD order          → notes out of the till (cash_on_hand), or, if the
    //                        cash was never collected, the receivable simply
    //                        unwinds — either way never gateway_clearing, which
    //                        would ask a PSP to refund money it never received.
    //   otherwise          → back out through the gateway
    let counter;
    if (rt.destination === REFUND_DESTINATION.WALLET) {
      counter = ledgerAccounts.walletLiability();
    } else {
      const cod = isCodPayment === null
        ? await this.orderWasPaidByCod(rt.orderId)
        : Boolean(isCodPayment);
      if (cod) {
        // Notes handed back at the door come out of the till; a refund on cash
        // that was NEVER collected has to unwind the receivable instead — there
        // is no cash_on_hand to draw from, and gateway_clearing would ask a PSP
        // to refund money it never received.
        const collected = await this.orderCodWasCollected(rt.orderId);
        counter = collected ? ledgerAccounts.cashOnHand() : ledgerAccounts.codReceivable();
      } else {
        counter = ledgerAccounts.gatewayClearing();
      }
    }

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
      traceId: rt.traceId || null,
    });
  }

  /** Canonical idempotency key for an order's sale journal. */
  saleKey(orderId) {
    return `${LEDGER_JOURNAL_KIND.SALE_CAPTURED}:order:${orderId}`;
  }

  /** Canonical idempotency key for a COD collection / deposit journal. */
  codCollectedKey(paymentId) {
    return `${LEDGER_JOURNAL_KIND.COD_COLLECTED}:payment:${paymentId}`;
  }
  codDepositKey(paymentId) {
    return `cod_deposit:payment:${paymentId}`;
  }

  /**
   * Did this order's money actually come from cash? Resolved from the PAYMENT
   * row (the money-movement truth), falling back to the order's method hint for
   * legacy rows that predate the provider stamp.
   * PURE: takes plain objects, so it is unit-testable without a database.
   */
  static isCodPayment(payment, order = null) {
    return isCodPayment(payment, order);
  }

  /** Was a COD order's cash actually collected? (drives the refund counter) */
  async orderCodWasCollected(orderId) {
    if (!orderId) return false;
    const payment = await Payment.findOne({ orderId }).select('provider method collectedAt').lean();
    return Boolean(payment?.collectedAt) && ledgerPosting.isCodPayment(payment);
  }

  /** DB-backed convenience wrapper used by the refund path. */
  async orderWasPaidByCod(orderId) {
    if (!orderId) return false;
    const payment = await Payment.findOne({ orderId }).lean();
    if (payment) return ledgerPosting.isCodPayment(payment);
    const order = await Order.findById(orderId).select('paymentMethod paymentSummary').lean();
    return Boolean(order && ledgerPosting.isCodPayment(null, order));
  }

  /**
   * COD collection: the rider took the cash at the door.
   *
   *   DR cash_on_hand      (notes now physically ours)
   *   CR cod_receivable    (the customer no longer owes us)
   *
   * This is a pure ASSET SWAP — it cannot change the total on the balance
   * sheet, which is why a COD order stays provably balanced at every step: the
   * sale raised the receivable, the collection converts it to cash, and the
   * deposit converts cash to bank. Idempotent on the payment id, so a rider
   * tapping twice (or two riders tapping at once) posts exactly once.
   *
   * The amount is taken from the Payment, never from the caller: what the
   * customer owes is a fact already on the row, and letting a client restate it
   * would turn a shortage into a balanced-looking journal.
   */
  async postCodCollected({ payment, order = null, collectedBy = null, occurredAt = null }) {
    const amountPaise = toPaise(payment.amountCollected ?? payment.amount ?? 0);
    if (amountPaise <= 0) {
      throw new AppError('Cannot post a COD collection for a non-positive amount', {
        status: 422, code: 'LEDGER_COD_EMPTY', details: { paymentId: String(payment._id) },
      });
    }
    return ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.COD_COLLECTED,
      idempotencyKey: this.codCollectedKey(payment._id),
      lines: [
        {
          accountCode: ledgerAccounts.cashOnHand(),
          debitPaise: amountPaise,
          creditPaise: 0,
          refType: 'payment',
          refId: payment._id,
          memo: `cash collected at delivery${collectedBy ? ` by ${collectedBy}` : ''}`,
        },
        {
          accountCode: ledgerAccounts.codReceivable(),
          debitPaise: 0,
          creditPaise: amountPaise,
          refType: 'payment',
          refId: payment._id,
          memo: `COD receivable settled${order?.orderNumber ? ` — order ${order.orderNumber}` : ''}`,
        },
      ],
      // The header refs the ORDER, not the payment, so the payout settlement
      // gate can ask one uniform question — "has this order's money reached
      // us?" — for gateway (`psp_settled`) and cash (`cod_collected`) alike,
      // through the same index. The payment id stays in meta and on each line.
      refType: 'order',
      refId: payment.orderId,
      tenantId: payment.tenantId,
      occurredAt: occurredAt || payment.collectedAt || new Date(),
      traceId: payment.traceId || order?.traceId || null,
      meta: {
        paymentId: String(payment._id),
        orderId: String(payment.orderId),
        orderNumber: order?.orderNumber || null,
        collectedBy: collectedBy ? String(collectedBy) : null,
      },
    });
  }

  /**
   * A cash order cancelled before collection: extinguish the receivable.
   *
   *   DR (whatever the sale credited — vendor payables, commission, GST)
   *   CR cod_receivable    the customer no longer owes us
   *
   * Reverses the sale journal proportionally, exactly like a refund, but with
   * `cod_receivable` as the counter and NO refund transaction: no money ever
   * arrived, so there is nothing to send back. Without this, cancelling a
   * confirmed COD order would leave a receivable on the balance sheet that can
   * never be collected — an asset that is really a loss, quietly overstating
   * the books forever.
   *
   * Idempotent on the order id (a cancellation may be retried).
   */
  async postCodReceivableWaived({ order, reason = 'order_cancelled', postedBy = null }) {
    const amountPaise = toPaise(order.totalAmount ?? 0);
    if (amountPaise <= 0) return { created: false, skipped: 'nothing_to_waive' };
    return ledgerService.reverseProportional({
      originalKey: this.saleKey(order._id),
      amountPaise,
      counterAccount: ledgerAccounts.codReceivable(),
      kind: LEDGER_JOURNAL_KIND.COD_RECEIVABLE_WAIVED,
      idempotencyKey: `${LEDGER_JOURNAL_KIND.COD_RECEIVABLE_WAIVED}:order:${order._id}`,
      refType: 'order',
      refId: order._id,
      occurredAt: new Date(),
      memo: `COD receivable waived — ${reason}`,
      postedBy,
      traceId: order.traceId || null,
    });
  }

  /**
   * COD remittance: the collected notes were banked.
   *
   *   DR bank / CR cash_on_hand
   *
   * Completing this is what closes the cash loop — after it, the exposure is in
   * a bank account where the existing statement reconciliation can prove it.
   * Idempotent on the payment id.
   */
  async postCodDeposit({ payment }) {
    const amountPaise = toPaise(payment.amountCollected ?? payment.amount ?? 0);
    if (amountPaise <= 0) {
      throw new AppError('Cannot post a COD deposit for a non-positive amount', {
        status: 422, code: 'LEDGER_COD_EMPTY', details: { paymentId: String(payment._id) },
      });
    }
    return ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.COD_COLLECTED,
      idempotencyKey: this.codDepositKey(payment._id),
      lines: [
        {
          accountCode: ledgerAccounts.bank(),
          debitPaise: amountPaise,
          creditPaise: 0,
          refType: 'payment',
          refId: payment._id,
          memo: `COD cash deposited${payment.depositRef ? ` — ${payment.depositRef}` : ''}`,
        },
        {
          accountCode: ledgerAccounts.cashOnHand(),
          debitPaise: 0,
          creditPaise: amountPaise,
          refType: 'payment',
          refId: payment._id,
          memo: 'cash on hand banked',
        },
      ],
      refType: 'order',
      refId: payment.orderId,
      tenantId: payment.tenantId,
      occurredAt: payment.depositedAt || new Date(),
      traceId: payment.traceId || null,
      meta: {
        paymentId: String(payment._id),
        orderId: String(payment.orderId),
        depositRef: payment.depositRef || null,
      },
    });
  }

  /**
   * Phase 16: a wallet top-up moves real money into the platform (the gateway
   * collects it) and raises what we owe the customer as wallet balance.
   * DR gateway_clearing / CR customer_wallet_liability — the clearing side is
   * swept to the bank by the normal settlement ingest, exactly like a sale.
   * (Goodwill credits have no gateway money: DR wallet_goodwill_expense.)
   */
  async postWalletTopup({ walletTransaction, goodwill = false }) {
    const txn = walletTransaction;
    const counter = goodwill
      ? ledgerAccounts.walletGoodwillExpense()
      : ledgerAccounts.gatewayClearing();
    return ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.WALLET_TOPUP,
      idempotencyKey: `${LEDGER_JOURNAL_KIND.WALLET_TOPUP}:wallet_txn:${txn._id}`,
      lines: [
        { accountCode: counter, debitPaise: Math.round(Number(txn.amount) * 100), creditPaise: 0, memo: `wallet top-up for ${txn.userId}` },
        { accountCode: ledgerAccounts.walletLiability(), debitPaise: 0, creditPaise: Math.round(Number(txn.amount) * 100), refType: 'wallet_transaction', refId: txn._id },
      ],
      refType: 'wallet_transaction',
      refId: txn._id,
      tenantId: txn.tenantId,
      occurredAt: txn.completedAt || txn.createdAt || new Date(),
    });
  }

  /**
   * Phase 17: a manual, reason-coded vendor adjustment is a money fact the
   * moment it is recorded — post it immediately (DR/CR vendor_payable vs
   * clearing), signed. The payout journal still drains it when the batch
   * pays, exactly like a line; this just keeps the books current in between.
   */
  async postAdjustment({ adjustment }) {
    const a = adjustment;
    const amt = Math.round(Number(a.amountPaise) || 0);
    if (amt === 0) throw new AppError('Adjustment amount must be non-zero', { status: 422, code: 'ADJUSTMENT_ZERO' });
    const vCode = ledgerAccounts.vendorPayable(a.vendorId);
    const lines = amt > 0
      ? [
        { accountCode: ledgerAccounts.gatewayClearing(), debitPaise: amt, creditPaise: 0, memo: `adjustment ${a.reasonCode}${a.note ? ` — ${a.note}` : ''}` },
        { accountCode: vCode, debitPaise: 0, creditPaise: amt, memo: 'adjustment' },
      ]
      : [
        { accountCode: vCode, debitPaise: -amt, creditPaise: 0, memo: `adjustment ${a.reasonCode}${a.note ? ` — ${a.note}` : ''}` },
        { accountCode: ledgerAccounts.gatewayClearing(), debitPaise: 0, creditPaise: -amt, memo: 'adjustment' },
      ];
    return ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.ADJUSTMENT,
      idempotencyKey: `adjustment:payout_adjustment:${a._id}`,
      lines,
      refType: 'payout_adjustment',
      refId: a._id,
      tenantId: null,
      meta: { reasonCode: a.reasonCode, note: a.note || null },
    });
  }

  /**
   * Phase 17: a one-time reconciliation of a vendor's payable against the
   * payout lines that should be on the books. Signed: `differencePaise > 0`
   * means the books UNDER-state what we owe (DR clearing / CR vendor_payable);
   * `< 0` the reverse. Exactly one journal, audited, never replayed.
   */
  async postVendorBackfill({ vendorId, differencePaise, note = null, idempotencyKey = null }) {
    const diff = Math.round(Number(differencePaise) || 0);
    if (diff === 0) throw new AppError('Backfill difference must be non-zero', { status: 422, code: 'VENDOR_BACKFILL_EMPTY' });
    const vCode = ledgerAccounts.vendorPayable(vendorId);
    const lines = diff > 0
      ? [
        { accountCode: ledgerAccounts.gatewayClearing(), debitPaise: diff, creditPaise: 0, memo: `vendor backfill: under-stated payable${note ? ` — ${note}` : ''}` },
        { accountCode: vCode, debitPaise: 0, creditPaise: diff, memo: 'vendor backfill' },
      ]
      : [
        { accountCode: vCode, debitPaise: -diff, creditPaise: 0, memo: `vendor backfill: over-stated payable${note ? ` — ${note}` : ''}` },
        { accountCode: ledgerAccounts.gatewayClearing(), debitPaise: 0, creditPaise: -diff, memo: 'vendor backfill' },
      ];
    return ledgerService.post({
      kind: LEDGER_JOURNAL_KIND.VENDOR_BACKFILL,
      idempotencyKey: idempotencyKey || `vendor_backfill:${vendorId}:${new Date().toISOString()}`,
      lines,
      refType: 'vendor',
      refId: vendorId,
      tenantId: null,
      meta: { differencePaise: diff, note: note || null },
    });
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

const ledgerPosting = new LedgerPostingService();
export { ledgerPosting };
export default ledgerPosting;
