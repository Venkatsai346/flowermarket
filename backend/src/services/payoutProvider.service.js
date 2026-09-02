import crypto from 'node:crypto';
import config from '../config/index.js';
import { PAYOUT_TRANSFER_MODE } from '../constants/enums.js';

/**
 * PayoutProvider — the disbursement gateway abstraction (Phase 6.3 / M5).
 *
 * Same shape as `paymentProvider` and `einvoiceProvider`: the rest of the
 * codebase only ever calls `payout()` / `fetchByIdempotencyKey()` /
 * `verifyWebhook()` and never learns which provider is configured.
 *
 * ── THE ONE RULE THAT MATTERS ───────────────────────────────────────────────
 * A payout call has THREE outcomes, not two:
 *
 *   success  → money is moving (or moved)
 *   failure  → the provider REJECTED it before touching money — safe to retry
 *   AMBIGUOUS→ timeout / 5xx / network reset. We do not know. Money may or may
 *              not be moving.
 *
 * Every real double-payment incident starts with treating the third case as
 * the second. So `payout()` never throws on a transport error: it returns
 * `{ ambiguous: true }`, the batch stays PROCESSING, and only
 * `fetchByIdempotencyKey()` (i.e. asking the provider what actually happened)
 * may resolve it. There is no retry path out of ambiguity — the state machine
 * has no `PROCESSING → QUEUED` edge for exactly this reason.
 *
 * ── Providers ───────────────────────────────────────────────────────────────
 *   console  (default) — logs the instruction, settles immediately. Dev.
 *   mock               — deterministic outcomes driven by the net amount, so
 *                        every unhappy path is testable without credentials:
 *                          …13 paise → FAILED (provider rejection)
 *                          …17 paise → PAID, then REVERSED by the bank
 *                          …99 paise → AMBIGUOUS (timeout); the reconciler
 *                                      later finds it actually PAID
 *   razorpayx          — real. `X-Payout-Idempotency` is our batch key, so a
 *                        duplicate submission is collapsed by the provider too.
 *   cashfree           — a second adapter, deliberately included so the
 *                        interface is not razorpay-shaped by accident.
 */

/** Transfer rails: IMPS is instant but capped; RTGS for large value. */
export function selectTransferMode({ method, amountPaise }) {
  if (method === 'upi') return PAYOUT_TRANSFER_MODE.UPI;
  const rupees = amountPaise / 100;
  if (rupees >= 200000) return PAYOUT_TRANSFER_MODE.RTGS;
  if (rupees <= 500000) return PAYOUT_TRANSFER_MODE.IMPS;
  return PAYOUT_TRANSFER_MODE.NEFT;
}

/** Deterministic outcome hook for the mock provider. */
export function mockOutcomeFor(amountPaise) {
  const tail = String(Math.abs(Math.round(amountPaise))).slice(-2).padStart(2, '0');
  if (tail === '13') return 'failed';
  if (tail === '17') return 'reversed';
  if (tail === '99') return 'ambiguous';
  return 'paid';
}

class PayoutProvider {
  get provider() {
    return config.payouts.provider || 'console';
  }

  /**
   * Instruct a disbursement.
   *
   * @returns {{ok:boolean, ambiguous?:boolean, providerRef?:string,
   *            status?:string, utr?:string, mode?:string, provider:string,
   *            error?:string, raw?:object}}
   */
  async payout({ idempotencyKey, amountPaise, account = {}, batchNumber = null, narration = null }) {
    const mode = selectTransferMode({ method: account.method, amountPaise });

    if (amountPaise <= 0) {
      return { ok: false, provider: this.provider, error: 'payout amount must be positive' };
    }

    if (this.provider === 'razorpayx') return this.razorpayxPayout({ idempotencyKey, amountPaise, account, batchNumber, narration, mode });
    if (this.provider === 'cashfree') return this.cashfreePayout({ idempotencyKey, amountPaise, account, batchNumber, narration, mode });

    // ---- console / mock ----
    const outcome = this.provider === 'mock' ? mockOutcomeFor(amountPaise) : 'paid';
    const ref = `pout_${crypto.createHash('sha1').update(idempotencyKey).digest('hex').slice(0, 16)}`;

    if (outcome === 'ambiguous') {
      // The call "timed out". We must NOT decide the outcome here.
      return { ok: false, ambiguous: true, provider: this.provider, providerRef: null, mode, error: 'gateway timeout — outcome unknown' };
    }
    if (outcome === 'failed') {
      return { ok: false, ambiguous: false, provider: this.provider, providerRef: ref, status: 'failed', mode, error: 'insufficient balance in payout account' };
    }

    if (this.provider === 'console') {
      // eslint-disable-next-line no-console
      console.log(`[payout] ${batchNumber || idempotencyKey} → ${account.maskedAccount || account.vpa} ₹${(amountPaise / 100).toFixed(2)} via ${mode}`);
    }

    return {
      ok: true,
      ambiguous: false,
      provider: this.provider,
      providerRef: ref,
      status: outcome === 'reversed' ? 'processing' : 'processed',
      utr: `UTR${crypto.createHash('sha1').update(`${idempotencyKey}utr`).digest('hex').slice(0, 12).toUpperCase()}`,
      mode,
      willReverse: outcome === 'reversed', // mock only: the bank bounces it later
      raw: { simulated: true, outcome },
    };
  }

  /**
   * Ask the provider what happened to an instruction we are unsure about.
   * This is the ONLY way out of an ambiguous submission.
   */
  async fetchByIdempotencyKey({ idempotencyKey, amountPaise = 0 }) {
    if (this.provider === 'razorpayx') return this.razorpayxFetch({ idempotencyKey });
    if (this.provider === 'cashfree') return this.cashfreeFetch({ idempotencyKey });

    // console/mock: the ambiguous case is resolved as PAID, which is the
    // dangerous reality we want tests to exercise — the money DID move, and a
    // naive retry would have sent it twice.
    const outcome = this.provider === 'mock' ? mockOutcomeFor(amountPaise) : 'paid';
    const ref = `pout_${crypto.createHash('sha1').update(idempotencyKey).digest('hex').slice(0, 16)}`;
    if (outcome === 'failed') {
      return { found: true, status: 'failed', providerRef: ref, provider: this.provider, error: 'insufficient balance in payout account' };
    }
    return {
      found: true,
      status: 'processed',
      providerRef: ref,
      utr: `UTR${crypto.createHash('sha1').update(`${idempotencyKey}utr`).digest('hex').slice(0, 12).toUpperCase()}`,
      provider: this.provider,
    };
  }

  /**
   * Verify a payout webhook signature.
   * RazorpayX uses the same scheme as Razorpay payments: HMAC-SHA256 of the
   * RAW body, compared in constant time — which is why the route is mounted
   * with `express.raw` before any JSON parsing.
   */
  verifyWebhook({ provider = this.provider, rawBody, signature, secret = null }) {
    if (provider === 'console' || provider === 'mock') return { ok: true };
    const s = secret || config.payouts.webhookSecret;
    if (!s) return { ok: false, error: 'payout webhook secret not configured' };
    if (!rawBody || !signature) return { ok: false, error: 'missing raw body or signature' };

    const expected = crypto.createHmac('sha256', s).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    if (a.length !== b.length) return { ok: false, error: 'signature mismatch' };
    return { ok: crypto.timingSafeEqual(a, b) };
  }

  /**
   * Normalise a provider webhook into our vocabulary.
   * RazorpayX: payout.processed | payout.failed | payout.reversed
   * Cashfree:  TRANSFER_SUCCESS | TRANSFER_FAILED | TRANSFER_REVERSED
   */
  parseWebhook(body) {
    const event = body?.event || body?.type || body?.eventType || null;
    const entity = body?.payload?.payout?.entity || body?.data || body || {};
    const map = {
      'payout.processed': 'paid',
      'payout.failed': 'failed',
      'payout.reversed': 'reversed',
      'payout.rejected': 'failed',
      TRANSFER_SUCCESS: 'paid',
      TRANSFER_FAILED: 'failed',
      TRANSFER_REVERSED: 'reversed',
    };
    return {
      event,
      outcome: map[event] || null,
      providerRef: entity.id || entity.transferId || entity.referenceId || null,
      idempotencyKey: entity.reference_id || entity.transferId || entity.idempotencyKey
        || entity.notes?.idempotencyKey || null,
      utr: entity.utr || entity.bankReference || null,
      failureReason: entity.failure_reason || entity.reason || entity.statusDescription || null,
      amountPaise: entity.amount ?? null,
    };
  }

  // ---- RazorpayX -----------------------------------------------------------

  async razorpayxPayout({ idempotencyKey, amountPaise, account, batchNumber, narration, mode }) {
    const { keyId, keySecret, accountNumber, baseUrl } = config.payouts.razorpayx;
    if (!keyId || !keySecret || !accountNumber) {
      return { ok: false, provider: 'razorpayx', error: 'RAZORPAYX credentials/account number not configured' };
    }
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const body = {
      account_number: accountNumber,
      amount: amountPaise,
      currency: 'INR',
      mode,
      purpose: 'vendor_payout',
      reference_id: idempotencyKey,
      narration: (narration || `Payout ${batchNumber || ''}`).slice(0, 30),
      queue_if_low_balance: true,
      fund_account: account.providerFundAccountId
        ? { id: account.providerFundAccountId }
        : {
          account_type: account.method === 'upi' ? 'vpa' : 'bank_account',
          ...(account.method === 'upi'
            ? { vpa: { address: account.vpa } }
            : { bank_account: { name: account.holderName, ifsc: account.ifsc, account_number: account.accountNumber } }),
        },
      notes: { idempotencyKey, batchNumber: batchNumber || '' },
    };

    try {
      const res = await fetch(`${(baseUrl || 'https://api.razorpay.com/v1').replace(/\/$/, '')}/payouts`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${auth}`,
          // provider-side idempotency: a duplicate POST is collapsed upstream
          'X-Payout-Idempotency': idempotencyKey,
        },
        body: JSON.stringify(body),
      });

      // 5xx and 429 are AMBIGUOUS: the instruction may have been accepted.
      if (res.status >= 500 || res.status === 429) {
        return { ok: false, ambiguous: true, provider: 'razorpayx', mode, error: `gateway HTTP ${res.status} — outcome unknown` };
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, ambiguous: false, provider: 'razorpayx', mode, error: json?.error?.description || `HTTP ${res.status}`, raw: json };
      }
      return {
        ok: true,
        ambiguous: false,
        provider: 'razorpayx',
        providerRef: json.id,
        status: json.status, // queued | pending | processing | processed
        utr: json.utr || null,
        mode,
        raw: json,
      };
    } catch (err) {
      // network reset / timeout — we genuinely do not know
      return { ok: false, ambiguous: true, provider: 'razorpayx', mode, error: `${err.message} — outcome unknown` };
    }
  }

  async razorpayxFetch({ idempotencyKey }) {
    const { keyId, keySecret, accountNumber, baseUrl } = config.payouts.razorpayx;
    if (!keyId || !keySecret) return { found: false, error: 'razorpayx not configured' };
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    try {
      const url = `${(baseUrl || 'https://api.razorpay.com/v1').replace(/\/$/, '')}/payouts?account_number=${encodeURIComponent(accountNumber)}&reference_id=${encodeURIComponent(idempotencyKey)}`;
      const res = await fetch(url, { headers: { authorization: `Basic ${auth}` } });
      if (!res.ok) return { found: false, error: `HTTP ${res.status}` };
      const json = await res.json().catch(() => ({}));
      const item = (json.items || [])[0];
      if (!item) return { found: false };
      const statusMap = { processed: 'processed', reversed: 'reversed', failed: 'failed', cancelled: 'failed' };
      return {
        found: true,
        status: statusMap[item.status] || 'pending',
        providerRef: item.id,
        utr: item.utr || null,
        provider: 'razorpayx',
        raw: item,
      };
    } catch (err) {
      return { found: false, error: err.message };
    }
  }

  // ---- Cashfree (second adapter, proving the interface) ---------------------

  async cashfreePayout({ idempotencyKey, amountPaise, account, batchNumber, mode }) {
    const { clientId, clientSecret, baseUrl } = config.payouts.cashfree;
    if (!clientId || !clientSecret) {
      return { ok: false, provider: 'cashfree', error: 'CASHFREE credentials not configured' };
    }
    try {
      const res = await fetch(`${(baseUrl || 'https://payout-api.cashfree.com').replace(/\/$/, '')}/payout/v1/requestTransfer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client-id': clientId, 'x-client-secret': clientSecret },
        body: JSON.stringify({
          beneId: account.providerBeneficiaryId,
          amount: (amountPaise / 100).toFixed(2),
          transferId: idempotencyKey,
          transferMode: String(mode).toLowerCase(),
          remarks: `Payout ${batchNumber || ''}`,
        }),
      });
      if (res.status >= 500 || res.status === 429) {
        return { ok: false, ambiguous: true, provider: 'cashfree', mode, error: `gateway HTTP ${res.status} — outcome unknown` };
      }
      const json = await res.json().catch(() => ({}));
      const ok = json?.status === 'SUCCESS' || json?.subCode === '200';
      return ok
        ? { ok: true, provider: 'cashfree', providerRef: json?.data?.referenceId || idempotencyKey, status: 'processing', utr: json?.data?.utr || null, mode, raw: json }
        : { ok: false, ambiguous: false, provider: 'cashfree', mode, error: json?.message || 'transfer rejected', raw: json };
    } catch (err) {
      return { ok: false, ambiguous: true, provider: 'cashfree', mode, error: `${err.message} — outcome unknown` };
    }
  }

  async cashfreeFetch({ idempotencyKey }) {
    const { clientId, clientSecret, baseUrl } = config.payouts.cashfree;
    if (!clientId || !clientSecret) return { found: false, error: 'cashfree not configured' };
    try {
      const res = await fetch(`${(baseUrl || 'https://payout-api.cashfree.com').replace(/\/$/, '')}/payout/v1.2/getTransferStatus?transferId=${encodeURIComponent(idempotencyKey)}`, {
        headers: { 'x-client-id': clientId, 'x-client-secret': clientSecret },
      });
      if (!res.ok) return { found: false, error: `HTTP ${res.status}` };
      const json = await res.json().catch(() => ({}));
      const t = json?.data?.transfer;
      if (!t) return { found: false };
      const map = { SUCCESS: 'processed', FAILED: 'failed', REVERSED: 'reversed', PENDING: 'pending' };
      return { found: true, status: map[t.status] || 'pending', providerRef: t.referenceId, utr: t.utr || null, provider: 'cashfree', raw: t };
    } catch (err) {
      return { found: false, error: err.message };
    }
  }
}

export default new PayoutProvider();
