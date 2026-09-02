import crypto from 'node:crypto';
import config from '../config/index.js';

/**
 * EinvoiceProvider — IRP (Invoice Registration Portal) abstraction.
 *
 * Mirrors `paymentProvider` / `notificationProvider` exactly: the rest of the
 * codebase only ever calls `generate()` / `cancel()` and never learns which
 * provider is configured.
 *
 *   console  (default) — logs the IRP payload and stamps a deterministic fake
 *                        IRN. Dev and demos.
 *   mock               — same, plus deterministic FAILURES so the retry queue
 *                        is exercisable: a supplier GSTIN ending in '13' always
 *                        fails (the same joke the payment mock uses).
 *   gsp                — a real GST Suvidha Provider. The request shape is
 *                        built here; the HTTP call is the only thing left to
 *                        wire, deliberately isolated to one method.
 *
 * WHEN IT APPLIES: only for suppliers whose TaxRegistration has
 * `einvoiceEnabled` (turnover above the notified threshold). Everyone else
 * gets `not_applicable` and no IRP round-trip.
 */
class EinvoiceProvider {
  get provider() {
    return config.tax.einvoice.provider || 'console';
  }

  /**
   * Build the IRP payload from a TaxDocument. Kept separate from the transport
   * so it can be asserted in tests and logged for support without a network
   * call. Field names follow the IRP schema (Version 1.1).
   */
  buildPayload(doc) {
    const rs = (p) => Number((p / 100).toFixed(2));
    return {
      Version: '1.1',
      TranDtls: {
        TaxSch: 'GST',
        SupTyp: doc.recipient?.gstin ? 'B2B' : 'B2C',
        RegRev: doc.reverseCharge ? 'Y' : 'N',
      },
      DocDtls: {
        Typ: doc.docType === 'credit_note' ? 'CRN' : 'INV',
        No: doc.number,
        Dt: new Date(doc.issuedAt || Date.now()).toLocaleDateString('en-GB').replace(/\//g, '/'),
      },
      SellerDtls: {
        Gstin: doc.supplier?.gstin || null,
        LglNm: doc.supplier?.name,
        Addr1: doc.supplier?.address?.line1 || '',
        Loc: doc.supplier?.address?.city || '',
        Pin: Number(doc.supplier?.address?.pincode) || null,
        Stcd: doc.supplier?.stateCode,
      },
      BuyerDtls: {
        Gstin: doc.recipient?.gstin || 'URP', // unregistered person
        LglNm: doc.recipient?.name,
        Pos: doc.placeOfSupplyStateCode,
        Addr1: doc.recipient?.address?.line1 || '',
        Loc: doc.recipient?.address?.city || '',
        Pin: Number(doc.recipient?.address?.pincode) || null,
        Stcd: doc.recipient?.stateCode || doc.placeOfSupplyStateCode,
      },
      ItemList: (doc.lines || []).map((l, i) => ({
        SlNo: String(i + 1),
        PrdDesc: l.description,
        IsServc: 'N',
        HsnCd: l.hsnCode || '',
        Qty: l.qty,
        Unit: l.uom || 'PCS',
        UnitPrice: rs(l.unitPricePaise || 0),
        TotAmt: rs(l.grossPaise),
        Discount: rs(l.discountPaise || 0),
        AssAmt: rs(l.taxableValuePaise),
        GstRt: (l.rateBps || 0) / 100,
        CgstAmt: rs(l.cgstPaise),
        SgstAmt: rs(l.sgstPaise),
        IgstAmt: rs(l.igstPaise),
        CesAmt: rs(l.cessPaise),
        TotItemVal: rs(l.lineTotalPaise),
      })),
      ValDtls: {
        AssVal: rs(doc.totals.taxableValuePaise),
        CgstVal: rs(doc.totals.cgstPaise),
        SgstVal: rs(doc.totals.sgstPaise),
        IgstVal: rs(doc.totals.igstPaise),
        CesVal: rs(doc.totals.cessPaise),
        RndOffAmt: rs(doc.totals.roundOffPaise),
        TotInvVal: rs(doc.totals.grandTotalPaise),
      },
    };
  }

  /**
   * Register a document with the IRP.
   * @returns {{success, irn?, ackNo?, ackDate?, signedQrPayload?, provider, error?}}
   */
  async generate(doc) {
    const payload = this.buildPayload(doc);

    if (this.provider === 'gsp') return this.gspGenerate(doc, payload);

    // deterministic failure hook so retries are testable without a GSP
    if (this.provider === 'mock' && String(doc.supplier?.gstin || '').endsWith('13')) {
      return { success: false, provider: 'mock', error: 'IRP rejected: duplicate IRN for document number' };
    }

    // IRN is a SHA-256 of supplier GSTIN + doc type + number + FY — the same
    // inputs the real IRP hashes, so the fake value has the right shape and
    // the same uniqueness guarantees.
    const irn = crypto
      .createHash('sha256')
      .update(`${doc.supplier?.gstin || 'URP'}|${doc.docType}|${doc.number}|${doc.fyLabel}`)
      .digest('hex');

    if (this.provider === 'console') {
      // eslint-disable-next-line no-console
      console.log(`[einvoice] ${doc.docType} ${doc.number} → IRN ${irn.slice(0, 16)}…`);
    }

    return {
      success: true,
      irn,
      ackNo: String(Date.now()).slice(-10),
      ackDate: new Date(),
      signedQrPayload: Buffer.from(JSON.stringify({
        irn,
        SellerGstin: payload.SellerDtls.Gstin,
        BuyerGstin: payload.BuyerDtls.Gstin,
        DocNo: doc.number,
        TotInvVal: payload.ValDtls.TotInvVal,
      })).toString('base64'),
      provider: this.provider,
      raw: { simulated: true },
    };
  }

  /**
   * Cancel an IRN. The IRP allows this only within a bounded window (24 hours
   * at the time of writing); after that the only lawful correction is a credit
   * note. The caller is told which happened rather than silently succeeding.
   */
  async cancel(doc, reason = 'Data entry mistake') {
    if (!doc.einvoice?.irn) return { success: false, error: 'no IRN to cancel' };
    const ackAge = doc.einvoice.ackDate ? Date.now() - new Date(doc.einvoice.ackDate).getTime() : 0;
    if (ackAge > 24 * 3600 * 1000) {
      return { success: false, expired: true, error: 'IRN cancellation window has passed — issue a credit note instead' };
    }
    if (this.provider === 'gsp') return this.gspCancel(doc, reason);
    return { success: true, provider: this.provider, cancelledAt: new Date() };
  }

  // ---- real GSP transport (the only network-bound code in this file) ----

  async gspGenerate(doc, payload) {
    const { baseUrl, apiKey, apiSecret } = config.tax.einvoice;
    if (!baseUrl || !apiKey) {
      return { success: false, provider: 'gsp', error: 'EINVOICE_GSP_BASE_URL / API key not configured' };
    }
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/einvoice/generate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          ...(apiSecret ? { 'x-api-secret': apiSecret } : {}),
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.Irn) {
        return { success: false, provider: 'gsp', error: body?.ErrorMessage || `IRP HTTP ${res.status}`, raw: body };
      }
      return {
        success: true,
        irn: body.Irn,
        ackNo: body.AckNo,
        ackDate: body.AckDt ? new Date(body.AckDt) : new Date(),
        signedQrPayload: body.SignedQRCode || null,
        provider: 'gsp',
        raw: body,
      };
    } catch (err) {
      return { success: false, provider: 'gsp', error: err.message };
    }
  }

  async gspCancel(doc, reason) {
    const { baseUrl, apiKey } = config.tax.einvoice;
    if (!baseUrl || !apiKey) return { success: false, error: 'GSP not configured' };
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/einvoice/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ Irn: doc.einvoice.irn, CnlRsn: '2', CnlRem: reason }),
      });
      const body = await res.json().catch(() => ({}));
      return { success: res.ok, provider: 'gsp', raw: body, error: res.ok ? null : (body?.ErrorMessage || `HTTP ${res.status}`) };
    } catch (err) {
      return { success: false, provider: 'gsp', error: err.message };
    }
  }
}

export default new EinvoiceProvider();
