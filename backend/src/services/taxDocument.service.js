import mongoose from 'mongoose';
import TaxDocument from '../models/taxDocument.model.js';
import TaxDocumentSeries from '../models/taxDocumentSeries.model.js';
import Order from '../models/order.model.js';
import OrderItem from '../models/orderItem.model.js';
import ProductMaster from '../models/productMaster.model.js';
import RefundTransaction from '../models/refundTransaction.model.js';
import User from '../models/user.model.js';
import taxService from './tax.service.js';
import einvoiceProvider from './einvoiceProvider.service.js';
import ledgerService from './ledger.service.js';
import auditService from './audit.service.js';
import config from '../config/index.js';
import { badRequest, conflict, notFound, AppError } from '../utils/ApiError.js';
import { serializeList } from '../utils/serialize.js';
import { toPaise, fromPaise, allocatePaise } from '../utils/money.js';
import {
  computeLineTax, buildHsnSummary, summariseInvoice, fyLabel,
  stateCodeFromName,
} from '../utils/gst.js';
import {
  TAX_DOC_TYPE, TAX_DOC_STATUS, TAX_OWNER_TYPE, EINVOICE_STATUS,
  CREDIT_NOTE_REASON, AUDIT_ACTION, ORDER_STATUS,
} from '../constants/enums.js';

/**
 * TaxDocumentService — issues legally valid invoices and credit notes.
 *
 * ── Three rules this service exists to enforce ──────────────────────────────
 *
 * 1. THE DOCUMENT MUST MATCH WHAT THE CUSTOMER PAID.
 *    Lines are built from the values PERSISTED on `orderitems` by the Phase 3.5
 *    pricing engine (lineTotal, discountAllocated, taxAmount) and run through
 *    `computeLineTax` in RECONSTRUCTION mode, where the charged tax is
 *    authoritative and only gets split into CGST/SGST/IGST. Today's rate table
 *    can never re-price a historical order.
 *
 * 2. NUMBERING IS GAPLESS AND PER FINANCIAL YEAR.
 *    The sequence is advanced atomically (`findOneAndUpdate($inc)`), inside the
 *    same transaction that writes the document when the deployment supports
 *    transactions. A document that must not exist is CANCELLED, never deleted,
 *    because a hole in the series is a question an auditor will ask.
 *
 * 3. ONE DOCUMENT PER SELLING ENTITY.
 *    A multi-vendor order is not one invoice: each vendor is a separate
 *    supplier making a separate supply, so the order yields one invoice per
 *    vendor (plus one for the store's own lines). This is why `issueForOrder`
 *    returns an array.
 *
 * ── Deliberately NOT here ───────────────────────────────────────────────────
 * No ledger journal is posted on issue. `sale_captured` already recognised
 * this money when the order was confirmed; a tax document is legal evidence of
 * a movement the ledger has, not a second movement.
 */

const UOM_MAP = { piece: 'PCS', kg: 'KGS', gram: 'GMS', litre: 'LTR', bunch: 'BUN', box: 'BOX', pack: 'PAC' };

/** Indian-format words for the amount line ("Rupees One Thousand Only"). */
function amountInWords(paise) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`);
  const three = (n) => (n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${two(n % 100)}` : ''}` : two(n));

  const rupees = Math.floor(Math.abs(paise) / 100);
  const paisaPart = Math.abs(paise) % 100;
  if (rupees === 0 && paisaPart === 0) return 'Rupees Zero Only';

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;

  const parts = [];
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${three(lakh)} Lakh`);
  if (thousand) parts.push(`${three(thousand)} Thousand`);
  if (rest) parts.push(three(rest));

  let out = `Rupees ${parts.join(' ') || 'Zero'}`;
  if (paisaPart) out += ` and ${two(paisaPart)} Paise`;
  return `${out} Only`;
}

const toId = (v) => (v == null ? null : (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v))));

class TaxDocumentService {
  // -------------------------------------------------------------------------
  // numbering
  // -------------------------------------------------------------------------

  /**
   * Reserve the next number in a series. Atomic `$inc` with upsert, so two
   * concurrent issuances can never take the same number.
   *
   * NOTE ON GAPLESSNESS: when the deployment supports transactions the caller
   * passes the session, so an aborted issuance releases the number. On a
   * standalone mongod a crash between reserving and writing can burn a number.
   * That is why `auditSeries()` exists and why `LEDGER`-style verification is
   * run nightly — a burnt number is reported, not hidden.
   */
  async reserveNumber({ ownerType, ownerId, docType, at = new Date(), seriesCode = 'A', session = null }) {
    const fy = fyLabel(at, config.tax.fyStartMonth);
    const prefix = docType === TAX_DOC_TYPE.CREDIT_NOTE ? config.tax.creditNotePrefix : config.tax.invoicePrefix;
    const width = config.tax.numberWidth;

    const series = await TaxDocumentSeries.findOneAndUpdate(
      { ownerType, ownerId: toId(ownerId), docType, fyLabel: fy, seriesCode },
      {
        $inc: { lastValue: 1 },
        $set: { lastIssuedAt: new Date() },
        $setOnInsert: { prefix, width, status: 'active' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, ...(session ? { session } : {}) }
    );

    const sequence = series.lastValue;
    const number = `${series.prefix}/${fy}/${String(sequence).padStart(series.width, '0')}`;

    // GST caps document numbers at 16 characters.
    if (number.length > 16) {
      throw badRequest(
        `Generated document number "${number}" exceeds the 16-character GST limit — shorten TAX_INVOICE_PREFIX or TAX_NUMBER_WIDTH`,
        'DOC_NUMBER_TOO_LONG'
      );
    }

    return { number, sequence, fyLabel: fy, seriesCode, prefix: series.prefix };
  }

  /** Report holes in a series (numbers reserved but never written). */
  async auditSeries({ ownerType, ownerId, docType, fyLabel: fy }) {
    const series = await TaxDocumentSeries.findOne({ ownerType, ownerId: toId(ownerId), docType, fyLabel: fy }).lean();
    if (!series) return { series: null, issued: 0, expected: 0, gaps: [] };

    const docs = await TaxDocument.find({
      supplierType: ownerType, docType, fyLabel: fy,
      ...(ownerType === TAX_OWNER_TYPE.VENDOR ? { vendorId: toId(ownerId) } : { tenantId: toId(ownerId) }),
    }).select('sequence number status').sort({ sequence: 1 }).lean();

    const seen = new Set(docs.map((d) => d.sequence));
    const gaps = [];
    for (let i = 1; i <= series.lastValue; i += 1) if (!seen.has(i)) gaps.push(i);

    return { series: series.fyLabel, issued: docs.length, expected: series.lastValue, gaps };
  }

  // -------------------------------------------------------------------------
  // issuing an invoice from an order
  // -------------------------------------------------------------------------

  /**
   * Issue tax invoices for an order — one per selling entity.
   * Idempotent: an order that already has issued invoices returns them.
   */
  async issueForOrder({ orderId, actorId = null, req = null, force = false }) {
    const order = await Order.findById(orderId).lean();
    if (!order) throw notFound('Order not found', 'ORDER_NOT_FOUND');

    const invoiceable = [
      ORDER_STATUS.CONFIRMED, ORDER_STATUS.PICKING, ORDER_STATUS.PACKED,
      ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED,
    ];
    if (!force && !invoiceable.includes(order.status)) {
      throw conflict(
        `Order is ${order.status} — an invoice is issued once the supply is confirmed`,
        'ORDER_NOT_INVOICEABLE'
      );
    }

    // ---- idempotency ----
    const existing = await TaxDocument.find({
      orderId: order._id, docType: TAX_DOC_TYPE.INVOICE, status: { $ne: TAX_DOC_STATUS.CANCELLED },
    }).lean();
    if (existing.length) return { documents: serializeList(existing), created: false };

    const items = await OrderItem.find({ orderId: order._id }).lean();
    if (!items.length) throw badRequest('Order has no items to invoice', 'ORDER_EMPTY');

    // ---- facts we need: category (for the rate) and place of supply ----
    const masters = await ProductMaster.find({ _id: { $in: items.map((i) => i.productMasterId).filter(Boolean) } })
      .select('_id categoryId defaultSellingUnit').lean();
    const categoryByMaster = new Map(masters.map((m) => [String(m._id), m.categoryId]));
    const unitByMaster = new Map(masters.map((m) => [String(m._id), m.defaultSellingUnit]));

    const supplyDate = order.paymentSummary?.paidAt || order.createdAt || new Date();
    const policies = await taxService.resolveTaxPolicies({
      categoryIds: items.map((i) => categoryByMaster.get(String(i.productMasterId))),
      at: supplyDate,
    });

    /**
     * Place of supply for GOODS is where the movement terminates — the
     * delivery address, which the order snapshotted immutably at checkout.
     * If it cannot be resolved we refuse rather than guess: guessing picks the
     * wrong tax heads, which is a filing error, not a cosmetic one.
     */
    const posStateCode = stateCodeFromName(order.addressSnapshot?.state);
    if (!posStateCode) {
      throw new AppError(
        `Cannot determine the place of supply from the delivery state "${order.addressSnapshot?.state || ''}"`,
        { status: 422, code: 'PLACE_OF_SUPPLY_UNRESOLVED', details: { orderId: String(order._id) } }
      );
    }

    const customer = await User.findById(order.userId).select('profile email phone').lean();

    // ---- group lines by selling entity ----
    const groups = new Map(); // key: vendorId|'store'
    for (const item of items) {
      const key = item.vendorId ? String(item.vendorId) : 'store';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    // The delivery fee is the STORE's supply, so it rides on the store's
    // document. If an order is vendor-only, it becomes the store's own
    // single-line invoice rather than being silently dropped.
    const deliveryFeePaise = toPaise(order.deliveryFee || 0);
    if (deliveryFeePaise > 0 && !groups.has('store')) groups.set('store', []);

    const created = [];
    for (const [key, groupItems] of groups) {
      const vendorId = key === 'store' ? null : key;
      // eslint-disable-next-line no-await-in-loop
      const doc = await this.issueSingleInvoice({
        order,
        items: groupItems,
        vendorId,
        categoryByMaster,
        unitByMaster,
        policies,
        posStateCode,
        customer,
        supplyDate,
        includeDeliveryFee: key === 'store' ? deliveryFeePaise : 0,
        actorId,
        req,
      });
      created.push(doc);
    }

    return { documents: serializeList(created.map((d) => d.toObject())), created: true };
  }

  /** Build + persist ONE invoice for one supplier's slice of an order. */
  async issueSingleInvoice({
    order, items, vendorId, categoryByMaster, unitByMaster, policies, posStateCode,
    customer, supplyDate, includeDeliveryFee = 0, actorId = null, req = null,
  }) {
    const { registration, supplierType } = await taxService.resolveSupplier({
      tenantId: order.tenantId, vendorId,
    });
    const supplierStateCode = registration.stateCode || config.tax.defaultStateCode;

    // ---- lines ----
    const lines = [];
    for (const item of items) {
      const categoryId = categoryByMaster.get(String(item.productMasterId));
      const policy = policies.get(String(categoryId));
      const rate = taxService.rateFromPolicy(policy);

      const grossPaise = toPaise(item.lineTotal || 0);
      const discountPaise = toPaise(item.discountAllocated || 0);
      const chargedTaxPaise = toPaise(item.taxAmount || 0);

      /**
       * RECONSTRUCTION MODE. The Phase 3.5 pipeline charged tax ON TOP of the
       * line (exclusive), so the customer paid gross − discount + tax. We feed
       * the engine that net and the tax that was actually charged, and it only
       * splits it into heads. Switching checkout to inclusive pricing is a
       * separate, flagged migration (it changes what customers are charged);
       * this document layer is correct either way.
       */
      const netChargedPaise = grossPaise - discountPaise + chargedTaxPaise;
      const computed = computeLineTax({
        grossPaise: netChargedPaise,
        discountPaise: 0,
        rateBps: rate.rateBps,
        cessBps: rate.cessBps,
        natureOfSupply: rate.natureOfSupply,
        supplierStateCode,
        placeOfSupplyStateCode: posStateCode,
        pricesInclusive: true,
        knownTaxPaise: chargedTaxPaise,
      });

      lines.push({
        orderItemId: item._id,
        description: item.skuSnapshot?.title || 'Item',
        hsnCode: item.hsnCode || rate.hsnCode || null,
        qty: item.qty,
        uom: UOM_MAP[unitByMaster.get(String(item.productMasterId))] || 'PCS',
        unitPricePaise: toPaise(item.priceAtOrder?.sellingPrice || 0),
        grossPaise,
        discountPaise,
        taxableValuePaise: computed.taxableValuePaise,
        rateBps: computed.effectiveRateBps,
        cessBps: rate.cessBps,
        natureOfSupply: computed.natureOfSupply,
        cgstPaise: computed.cgstPaise,
        sgstPaise: computed.sgstPaise,
        igstPaise: computed.igstPaise,
        cessPaise: computed.cessPaise,
        lineTotalPaise: computed.lineTotalPaise,
      });
    }

    // ---- delivery fee as its own line (a service supplied by the store) ----
    if (includeDeliveryFee > 0) {
      const computed = computeLineTax({
        grossPaise: includeDeliveryFee,
        rateBps: 0,
        natureOfSupply: 'nil_rated', // conservative until a delivery HSN/rate is configured
        supplierStateCode,
        placeOfSupplyStateCode: posStateCode,
      });
      lines.push({
        orderItemId: null,
        description: 'Delivery charges',
        hsnCode: '996812',
        qty: 1,
        uom: 'OTH',
        unitPricePaise: includeDeliveryFee,
        grossPaise: includeDeliveryFee,
        discountPaise: 0,
        taxableValuePaise: computed.taxableValuePaise,
        rateBps: 0,
        cessBps: 0,
        natureOfSupply: computed.natureOfSupply,
        cgstPaise: computed.cgstPaise,
        sgstPaise: computed.sgstPaise,
        igstPaise: computed.igstPaise,
        cessPaise: 0,
        lineTotalPaise: computed.lineTotalPaise,
      });
    }

    const totals = summariseInvoice(lines);
    const hsnSummary = buildHsnSummary(lines);

    // ---- reserve a number and persist, atomically where possible ----
    const doc = await ledgerService.withOptionalTransaction(async (session) => {
      const numbering = await this.reserveNumber({
        ownerType: supplierType,
        ownerId: vendorId || order.tenantId,
        docType: TAX_DOC_TYPE.INVOICE,
        at: supplyDate,
        session,
      });

      const [saved] = await TaxDocument.create([{
        docType: TAX_DOC_TYPE.INVOICE,
        number: numbering.number,
        seriesCode: numbering.seriesCode,
        fyLabel: numbering.fyLabel,
        sequence: numbering.sequence,

        tenantId: order.tenantId,
        vendorId: vendorId || null,
        supplierType,

        orderId: order._id,
        orderNumber: order.orderNumber,

        supplier: {
          name: registration.legalName,
          tradeName: registration.tradeName,
          gstin: registration.gstin || null,
          stateCode: supplierStateCode,
          address: registration.address || {},
          email: registration.contact?.email || null,
          phone: registration.contact?.phone || null,
        },
        recipient: {
          name: order.addressSnapshot?.name
            || [customer?.profile?.firstName, customer?.profile?.lastName].filter(Boolean).join(' ')
            || 'Customer',
          gstin: null, // B2C by default; B2B capture is a follow-up
          stateCode: posStateCode,
          address: {
            line1: order.addressSnapshot?.line1 || null,
            line2: order.addressSnapshot?.line2 || null,
            city: order.addressSnapshot?.city || null,
            state: order.addressSnapshot?.state || null,
            pincode: order.addressSnapshot?.pincode || null,
          },
          email: customer?.email?.address || null,
          phone: order.addressSnapshot?.phone || customer?.phone?.number || null,
        },
        placeOfSupplyStateCode: posStateCode,

        supplyDate,
        issuedAt: new Date(),
        lines,
        hsnSummary,
        totals,
        amountInWords: amountInWords(totals.grandTotalPaise),
        status: TAX_DOC_STATUS.ISSUED,
        einvoice: {
          status: registration.einvoiceEnabled ? EINVOICE_STATUS.PENDING : EINVOICE_STATUS.NOT_APPLICABLE,
        },
        issuedBy: actorId,
      }], session ? { session } : {});

      return saved;
    });

    await auditService.record({
      action: AUDIT_ACTION.INVOICE_ISSUE,
      entityType: 'tax_document',
      entityId: doc._id,
      tenantId: order.tenantId,
      actorId,
      actorType: actorId ? 'admin' : 'system',
      after: {
        number: doc.number,
        orderNumber: order.orderNumber,
        grandTotal: fromPaise(totals.grandTotalPaise),
        supplier: doc.supplier.gstin || doc.supplier.name,
      },
      req,
    }).catch(() => {});

    // e-invoice registration is best-effort: a document is legally issued the
    // moment it is numbered; a failed IRN goes to the retry queue.
    if (doc.einvoice.status === EINVOICE_STATUS.PENDING) {
      await this.requestIrn(doc).catch(() => {});
    }

    return doc;
  }

  // -------------------------------------------------------------------------
  // credit notes
  // -------------------------------------------------------------------------

  /**
   * Issue a credit note for a refund (s.34).
   *
   * The tax reversed is a PROPORTIONAL SLICE OF THE ORIGINAL INVOICE'S LINES —
   * exactly the principle the ledger uses for `refund_issued`. We never
   * recompute tax from today's rate: the original document is the authority,
   * which is why every line stores its own `rateBps`.
   */
  async issueCreditNoteForRefund({ refundTransactionId, reason = CREDIT_NOTE_REASON.RETURN, actorId = null, req = null }) {
    const refund = await RefundTransaction.findById(refundTransactionId).lean();
    if (!refund) throw notFound('Refund transaction not found', 'REFUND_NOT_FOUND');

    const existing = await TaxDocument.findOne({
      refundTransactionId: refund._id,
      docType: TAX_DOC_TYPE.CREDIT_NOTE,
      status: { $ne: TAX_DOC_STATUS.CANCELLED },
    }).lean();
    if (existing) return { document: existing, created: false };

    const invoices = await TaxDocument.find({
      orderId: refund.orderId, docType: TAX_DOC_TYPE.INVOICE, status: TAX_DOC_STATUS.ISSUED,
    }).sort({ sequence: 1 }).lean();
    if (!invoices.length) throw conflict('No issued invoice to credit for this order', 'NO_INVOICE_FOR_ORDER');

    // A refund is allocated across the order's invoices by value, so a
    // multi-vendor refund credits each supplier its own share.
    const refundPaise = toPaise(refund.amount);
    const shares = allocatePaise(refundPaise, invoices.map((i) => i.totals.grandTotalPaise));

    const created = [];
    for (let i = 0; i < invoices.length; i += 1) {
      if (shares[i] <= 0) continue;
      // eslint-disable-next-line no-await-in-loop
      const note = await this.issueCreditNoteAgainst({
        invoice: invoices[i],
        amountPaise: shares[i],
        reason,
        refund,
        actorId,
        req,
      });
      created.push(note);
    }

    return { documents: serializeList(created.map((d) => d.toObject())), created: true };
  }

  /** Credit a specific invoice by a specific amount, proportionally per line. */
  async issueCreditNoteAgainst({ invoice, amountPaise, reason, refund = null, actorId = null, req = null }) {
    if (amountPaise <= 0) throw badRequest('Credit amount must be positive', 'INVALID_AMOUNT');
    if (amountPaise > invoice.totals.grandTotalPaise) {
      throw conflict(
        `Cannot credit ₹${fromPaise(amountPaise)} against invoice ${invoice.number} (₹${fromPaise(invoice.totals.grandTotalPaise)})`,
        'CREDIT_EXCEEDS_INVOICE'
      );
    }

    const weights = invoice.lines.map((l) => l.lineTotalPaise);
    const shares = allocatePaise(amountPaise, weights);

    const lines = invoice.lines.map((l, i) => {
      const share = shares[i];
      if (share <= 0) return null;
      // Reverse the SAME heads at the SAME rate the invoice used.
      const computed = computeLineTax({
        grossPaise: share,
        rateBps: l.rateBps,
        cessBps: l.cessBps,
        natureOfSupply: l.natureOfSupply,
        supplierStateCode: invoice.supplier.stateCode,
        placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
        pricesInclusive: true,
      });
      const ratio = l.lineTotalPaise > 0 ? share / l.lineTotalPaise : 0;
      return {
        orderItemId: l.orderItemId,
        description: l.description,
        hsnCode: l.hsnCode,
        qty: Number((l.qty * ratio).toFixed(3)),
        uom: l.uom,
        unitPricePaise: l.unitPricePaise,
        grossPaise: share,
        discountPaise: 0,
        taxableValuePaise: computed.taxableValuePaise,
        rateBps: l.rateBps,
        cessBps: l.cessBps,
        natureOfSupply: l.natureOfSupply,
        cgstPaise: computed.cgstPaise,
        sgstPaise: computed.sgstPaise,
        igstPaise: computed.igstPaise,
        cessPaise: computed.cessPaise,
        lineTotalPaise: computed.lineTotalPaise,
      };
    }).filter(Boolean);

    const totals = summariseInvoice(lines);
    const ownerId = invoice.supplierType === TAX_OWNER_TYPE.VENDOR ? invoice.vendorId : invoice.tenantId;

    const doc = await ledgerService.withOptionalTransaction(async (session) => {
      const numbering = await this.reserveNumber({
        ownerType: invoice.supplierType,
        ownerId,
        docType: TAX_DOC_TYPE.CREDIT_NOTE,
        at: new Date(),
        session,
      });

      const [saved] = await TaxDocument.create([{
        docType: TAX_DOC_TYPE.CREDIT_NOTE,
        number: numbering.number,
        seriesCode: numbering.seriesCode,
        fyLabel: numbering.fyLabel,
        sequence: numbering.sequence,

        tenantId: invoice.tenantId,
        vendorId: invoice.vendorId,
        supplierType: invoice.supplierType,

        orderId: invoice.orderId,
        orderNumber: invoice.orderNumber,
        originalDocumentId: invoice._id,
        originalNumber: invoice.number,
        refundTransactionId: refund?._id || null,
        returnRequestId: refund?.returnRequestId || null,
        reason,

        supplier: invoice.supplier,
        recipient: invoice.recipient,
        placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,

        supplyDate: new Date(),
        issuedAt: new Date(),
        lines,
        hsnSummary: buildHsnSummary(lines),
        totals,
        amountInWords: amountInWords(totals.grandTotalPaise),
        status: TAX_DOC_STATUS.ISSUED,
        einvoice: {
          status: invoice.einvoice?.irn ? EINVOICE_STATUS.PENDING : EINVOICE_STATUS.NOT_APPLICABLE,
        },
        issuedBy: actorId,
      }], session ? { session } : {});

      return saved;
    });

    await auditService.record({
      action: AUDIT_ACTION.CREDIT_NOTE_ISSUE,
      entityType: 'tax_document',
      entityId: doc._id,
      tenantId: invoice.tenantId,
      actorId,
      actorType: actorId ? 'admin' : 'system',
      after: {
        number: doc.number,
        against: invoice.number,
        amount: fromPaise(totals.grandTotalPaise),
        reason,
      },
      req,
    }).catch(() => {});

    if (doc.einvoice.status === EINVOICE_STATUS.PENDING) {
      await this.requestIrn(doc).catch(() => {});
    }

    return doc;
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  /**
   * Cancel a document. The number is KEPT (gapless series) and the document
   * remains queryable — only its status changes. Anything already credited or
   * settled must be corrected with a credit note instead.
   */
  async cancel({ documentId, reason, tenantId = null, actorId = null, req = null }) {
    const q = { _id: documentId };
    if (tenantId) q.tenantId = tenantId;
    const doc = await TaxDocument.findOne(q);
    if (!doc) throw notFound('Document not found', 'TAX_DOC_NOT_FOUND');
    if (doc.status === TAX_DOC_STATUS.CANCELLED) return doc;

    const credits = await TaxDocument.countDocuments({
      originalDocumentId: doc._id, status: TAX_DOC_STATUS.ISSUED,
    });
    if (credits > 0) {
      throw conflict('This invoice has credit notes against it — cancel is no longer lawful', 'INVOICE_HAS_CREDIT_NOTES');
    }

    if (doc.einvoice?.irn) {
      const res = await einvoiceProvider.cancel(doc, reason);
      if (!res.success && res.expired) {
        throw conflict(
          'The IRN cancellation window has passed — issue a credit note instead of cancelling',
          'EINVOICE_CANCEL_WINDOW_PASSED'
        );
      }
      doc.einvoice.status = res.success ? EINVOICE_STATUS.CANCELLED : doc.einvoice.status;
    }

    doc.status = TAX_DOC_STATUS.CANCELLED;
    doc.cancelledAt = new Date();
    doc.cancelReason = reason || null;
    await doc.save();

    await auditService.record({
      action: AUDIT_ACTION.INVOICE_CANCEL,
      entityType: 'tax_document',
      entityId: doc._id,
      tenantId: doc.tenantId,
      actorId,
      actorType: 'admin',
      before: { status: TAX_DOC_STATUS.ISSUED },
      after: { status: TAX_DOC_STATUS.CANCELLED, reason },
      req,
    }).catch(() => {});

    return doc;
  }

  /** Register (or re-register) a document with the IRP. */
  async requestIrn(documentOrId) {
    const doc = typeof documentOrId === 'object' && documentOrId.save
      ? documentOrId
      : await TaxDocument.findById(documentOrId);
    if (!doc) throw notFound('Document not found', 'TAX_DOC_NOT_FOUND');
    if (doc.einvoice?.irn) return doc;

    const res = await einvoiceProvider.generate(doc);
    doc.einvoice.attempts = (doc.einvoice.attempts || 0) + 1;
    doc.einvoice.provider = res.provider;
    if (res.success) {
      doc.einvoice.status = EINVOICE_STATUS.GENERATED;
      doc.einvoice.irn = res.irn;
      doc.einvoice.ackNo = res.ackNo;
      doc.einvoice.ackDate = res.ackDate;
      doc.einvoice.signedQrPayload = res.signedQrPayload;
      doc.einvoice.lastError = null;
    } else {
      doc.einvoice.status = EINVOICE_STATUS.FAILED;
      doc.einvoice.lastError = String(res.error || 'unknown IRP error').slice(0, 400);
    }
    await doc.save();
    return doc;
  }

  /** Retry queue for failed IRN registrations (nightly). */
  async retryFailedEinvoices({ limit = 50 } = {}) {
    const docs = await TaxDocument.find({
      'einvoice.status': { $in: [EINVOICE_STATUS.PENDING, EINVOICE_STATUS.FAILED] },
      'einvoice.attempts': { $lt: 10 },
      status: TAX_DOC_STATUS.ISSUED,
    }).limit(limit);

    let generated = 0;
    let stillFailing = 0;
    for (const doc of docs) {
      // eslint-disable-next-line no-await-in-loop
      const updated = await this.requestIrn(doc).catch(() => null);
      if (updated?.einvoice?.status === EINVOICE_STATUS.GENERATED) generated += 1;
      else stillFailing += 1;
    }
    return { scanned: docs.length, generated, stillFailing };
  }

  // -------------------------------------------------------------------------
  // reads
  // -------------------------------------------------------------------------

  async list({ tenantId = null, query = {} }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const q = {};
    if (tenantId) q.tenantId = tenantId;
    if (query.docType) q.docType = query.docType;
    if (query.status) q.status = query.status;
    if (query.vendorId) q.vendorId = query.vendorId;
    if (query.orderId) q.orderId = query.orderId;
    if (query.fyLabel) q.fyLabel = query.fyLabel;
    if (query.from || query.to) {
      q.issuedAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }

    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      TaxDocument.find(q).sort({ issuedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      TaxDocument.countDocuments(q),
    ]);
    return {
      items: serializeList(docs).map((d) => this.withRupeeView(d)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: skip + docs.length < total },
    };
  }

  async detail({ documentId, tenantId = null, orderId = null }) {
    const q = documentId ? { _id: documentId } : { orderId, docType: TAX_DOC_TYPE.INVOICE };
    if (tenantId) q.tenantId = tenantId;
    const doc = await TaxDocument.findOne(q).lean();
    if (!doc) throw notFound('Document not found', 'TAX_DOC_NOT_FOUND');
    return this.withRupeeView({ ...doc, id: String(doc._id) });
  }

  /** Attach rupee values alongside paise so clients never divide by 100. */
  withRupeeView(doc) {
    return {
      ...doc,
      totalsRupees: {
        taxableValue: fromPaise(doc.totals?.taxableValuePaise || 0),
        cgst: fromPaise(doc.totals?.cgstPaise || 0),
        sgst: fromPaise(doc.totals?.sgstPaise || 0),
        igst: fromPaise(doc.totals?.igstPaise || 0),
        cess: fromPaise(doc.totals?.cessPaise || 0),
        totalTax: fromPaise(doc.totals?.totalTaxPaise || 0),
        roundOff: fromPaise(doc.totals?.roundOffPaise || 0),
        grandTotal: fromPaise(doc.totals?.grandTotalPaise || 0),
      },
    };
  }
}

export default new TaxDocumentService();
