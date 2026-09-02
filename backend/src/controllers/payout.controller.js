import crypto from 'node:crypto';
import payoutService from '../services/payout.service.js';
import payoutProvider from '../services/payoutProvider.service.js';
import VendorPayoutAccount from '../models/vendorPayoutAccount.model.js';
import Vendor from '../models/vendor.model.js';
import auditService from '../services/audit.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';
import { notFound, badRequest } from '../utils/ApiError.js';
import { toPaise } from '../utils/money.js';
import { AUDIT_ACTION, BANK_VERIFICATION_STATUS, KYC_STATUS } from '../constants/enums.js';

/** Bank details are never returned raw — only a mask and a fingerprint. */
const mask = (acct) => (acct ? `****${String(acct).slice(-4)}` : null);
const fingerprintOf = ({ method, accountNumber, ifsc, vpa }) =>
  crypto.createHash('sha256').update(method === 'upi' ? String(vpa) : `${accountNumber}|${ifsc}`).digest('hex');

/** How long payouts stay frozen after a destination change. */
const BANK_CHANGE_FREEZE_MS = 24 * 3600 * 1000;

class PayoutController {
  /** Resolve the vendor profile behind the authenticated vendor user. */
  async vendorFor(req) {
    const vendor = await Vendor.findOne({ userId: req.auth.userId }).lean();
    if (!vendor) throw notFound('Vendor profile not found', 'VENDOR_NOT_FOUND');
    return vendor;
  }

  // ---------------- vendor: own payouts ----------------
  myPayouts = asyncHandler(async (req, res) => {
    const vendor = await this.vendorFor(req);
    const result = await payoutService.listBatches({ vendorId: vendor._id, query: req.query });
    res.status(200).json(success(result.items, { meta: result.meta, message: 'Payouts fetched' }));
  });

  myPayoutStatement = asyncHandler(async (req, res) => {
    const vendor = await this.vendorFor(req);
    const stmt = await payoutService.statement({ batchId: req.params.id, vendorId: vendor._id });
    res.status(200).json(success(stmt, { message: 'Statement fetched' }));
  });

  myUpcoming = asyncHandler(async (req, res) => {
    const vendor = await this.vendorFor(req);
    res.status(200).json(success(await payoutService.upcoming({ vendorId: vendor._id }), { message: 'Upcoming payout' }));
  });

  // ---------------- vendor: payout account & KYC ----------------
  getMyAccount = asyncHandler(async (req, res) => {
    const vendor = await this.vendorFor(req);
    const account = await VendorPayoutAccount.findOne({ vendorId: vendor._id, isDefault: true }).lean();
    res.status(200).json(success(account, { message: account ? 'Account fetched' : 'No payout account yet' }));
  });

  /**
   * Save bank details. Any change of DESTINATION resets verification and
   * freezes payouts for 24h — the standard defence against an account-takeover
   * redirecting the next disbursement.
   */
  upsertMyAccount = asyncHandler(async (req, res) => {
    const vendor = await this.vendorFor(req);
    const { method, accountHolderName, accountNumber, ifsc, vpa, bankName } = req.body;
    const fingerprint = fingerprintOf({ method, accountNumber, ifsc, vpa });

    const existing = await VendorPayoutAccount.findOne({ vendorId: vendor._id, isDefault: true });
    const changed = !existing || existing.fingerprint !== fingerprint;

    const account = await VendorPayoutAccount.findOneAndUpdate(
      { vendorId: vendor._id, isDefault: true },
      {
        $set: {
          vendorId: vendor._id,
          method,
          accountHolderName,
          accountNumberEnc: accountNumber ? Buffer.from(String(accountNumber)).toString('base64') : null,
          ifsc: ifsc || null,
          vpa: vpa || null,
          bankName: bankName || null,
          maskedAccount: method === 'upi' ? vpa : mask(accountNumber),
          fingerprint,
          isDefault: true,
          status: 'active',
          ...(changed ? {
            'verification.status': BANK_VERIFICATION_STATUS.UNVERIFIED,
            'verification.verifiedAt': null,
            frozenUntil: new Date(Date.now() + BANK_CHANGE_FREEZE_MS),
          } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await auditService.record({
      action: AUDIT_ACTION.UPDATE, entityType: 'vendor_payout_account', entityId: account._id,
      actorId: req.auth.userId, actorType: 'tenant',
      after: { method, masked: account.maskedAccount, changed, frozenUntil: account.frozenUntil }, req,
    }).catch(() => {});

    res.status(200).json(success(account, {
      message: changed
        ? 'Payout account saved — re-verification required and payouts are frozen for 24 hours'
        : 'Payout account unchanged',
    }));
  });

  /** Penny-drop / VPA validation. Mocked until a provider is wired in M5. */
  verifyMyAccount = asyncHandler(async (req, res) => {
    const vendor = await this.vendorFor(req);
    const account = await VendorPayoutAccount.findOne({ vendorId: vendor._id, isDefault: true });
    if (!account) throw notFound('No payout account to verify', 'PAYOUT_NO_ACCOUNT');

    account.verification = {
      status: BANK_VERIFICATION_STATUS.VERIFIED,
      method: account.method === 'upi' ? 'vpa_validate' : 'penny_drop',
      ref: `verify_${Date.now()}`,
      nameMatchScore: 1,
      verifiedAt: new Date(),
      lastError: null,
    };
    await account.save();

    await auditService.record({
      action: AUDIT_ACTION.BANK_VERIFY, entityType: 'vendor_payout_account', entityId: account._id,
      actorId: req.auth.userId, actorType: 'tenant', after: { status: 'verified' }, req,
    }).catch(() => {});

    res.status(200).json(success(account, { message: 'Account verified' }));
  });

  submitKyc = asyncHandler(async (req, res) => {
    const vendor = await this.vendorFor(req);
    const account = await VendorPayoutAccount.findOneAndUpdate(
      { vendorId: vendor._id, isDefault: true },
      {
        $set: {
          'kyc.pan': req.body.pan,
          'kyc.gstin': req.body.gstin || null,
          'kyc.documents': req.body.documents || [],
          'kyc.status': KYC_STATUS.PENDING,
          'kyc.rejectionReason': null,
        },
        $setOnInsert: { vendorId: vendor._id, isDefault: true },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(200).json(success(account, { message: 'KYC submitted for review' }));
  });

  // ---------------- platform ----------------
  listPayouts = asyncHandler(async (req, res) => {
    const result = await payoutService.listBatches({ vendorId: req.query.vendorId || null, query: req.query });
    res.status(200).json(success(result.items, { meta: result.meta, message: 'Payouts fetched' }));
  });

  getPayout = asyncHandler(async (req, res) => {
    res.status(200).json(success(await payoutService.statement({ batchId: req.params.id }), { message: 'Payout fetched' }));
  });

  computeCycle = asyncHandler(async (req, res) => {
    const { from, to, vendorId } = req.body;
    const result = vendorId
      ? await payoutService.computeCycleForVendor({ vendorId, from, to, actorId: req.auth.userId, req })
      : await payoutService.computeCycle({ from, to, actorId: req.auth.userId, req });
    res.status(201).json(created(result, { message: 'Payout cycle computed' }));
  });

  submitForApproval = asyncHandler(async (req, res) => {
    const batch = await payoutService.submitForApproval({ batchId: req.params.id, actorId: req.auth.userId, req });
    res.status(200).json(success(batch, { message: 'Submitted for approval' }));
  });

  approve = asyncHandler(async (req, res) => {
    const result = await payoutService.approve({
      batchId: req.params.id, actorId: req.auth.userId, note: req.body.note, req,
    });
    res.status(200).json(success(result.batch, {
      message: result.approvals >= result.needed
        ? 'Approved'
        : `Approval ${result.approvals} of ${result.needed} recorded`,
    }));
  });

  reject = asyncHandler(async (req, res) => {
    const batch = await payoutService.reject({ batchId: req.params.id, reason: req.body.reason, actorId: req.auth.userId, req });
    res.status(200).json(success(batch, { message: 'Payout rejected' }));
  });

  cancel = asyncHandler(async (req, res) => {
    const batch = await payoutService.cancel({ batchId: req.params.id, reason: req.body.reason, actorId: req.auth.userId, req });
    res.status(200).json(success(batch, { message: 'Payout cancelled, lines released' }));
  });

  hold = asyncHandler(async (req, res) => {
    const result = await payoutService.holdLines({ ...req.body, actorId: req.auth.userId, req });
    res.status(200).json(success(result, { message: 'Lines held' }));
  });

  release = asyncHandler(async (req, res) => {
    const result = await payoutService.releaseLines({ lineIds: req.body.lineIds, actorId: req.auth.userId, req });
    res.status(200).json(success(result, { message: 'Lines released' }));
  });

  addAdjustment = asyncHandler(async (req, res) => {
    const doc = await payoutService.addAdjustment({
      vendorId: req.body.vendorId,
      amountPaise: toPaise(req.body.amount),
      reasonCode: req.body.reasonCode,
      note: req.body.note,
      orderId: req.body.orderId,
      actorId: req.auth.userId,
      req,
    });
    res.status(201).json(created(doc, { message: 'Adjustment recorded' }));
  });

  markEligible = asyncHandler(async (req, res) => {
    res.status(200).json(success(await payoutService.markEligible({}), { message: 'Eligibility sweep complete' }));
  });

  getPolicy = asyncHandler(async (req, res) => {
    res.status(200).json(success(await payoutService.resolvePolicy({ vendorId: req.query.vendorId || null }), { message: 'Policy fetched' }));
  });

  upsertPolicy = asyncHandler(async (req, res) => {
    const { scope, vendorId, ...payload } = req.body;
    const doc = await payoutService.upsertPolicy({ scope, vendorId, payload, actorId: req.auth.userId, req });
    res.status(200).json(success(doc, { message: 'Policy saved' }));
  });

  submit = asyncHandler(async (req, res) => {
    const result = await payoutService.submit({ batchId: req.params.id, actorId: req.auth.userId, req });
    const message = result.ambiguous
      ? 'Submission outcome is UNKNOWN — the batch is left in processing for reconciliation and will NOT be retried'
      : (result.failed ? `Provider rejected the payout: ${result.error}` : 'Payout submitted');
    res.status(result.failed ? 409 : 202).json(success(result.batch, { message }));
  });

  reconcile = asyncHandler(async (req, res) => {
    const result = await payoutService.reconcileInFlight({ olderThanMinutes: Number(req.body?.olderThanMinutes) || null });
    res.status(200).json(success(result, { message: 'Reconciliation sweep complete' }));
  });

  ingestSettlements = asyncHandler(async (req, res) => {
    const result = await payoutService.ingestPspSettlements({
      rows: req.body.rows || [], reference: req.body.reference || null,
    });
    res.status(200).json(success(result, { message: 'Settlement report ingested' }));
  });

  /**
   * Provider webhook. Mounted with express.raw BEFORE any JSON parsing, because
   * the HMAC is computed over the exact bytes. An unverified payout webhook
   * would let anyone mark a batch as paid, so a bad signature is a hard 401.
   */
  webhook = asyncHandler(async (req, res) => {
    const signature = req.get('x-razorpay-signature') || req.get('x-webhook-signature') || req.get('x-cf-signature');
    const rawBody = req.body; // Buffer

    const verified = payoutProvider.verifyWebhook({ rawBody, signature });
    if (!verified.ok) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature', code: 'BAD_WEBHOOK_SIGNATURE', details: verified.error || null });
    }

    let body = {};
    try { body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '{}')); } catch { body = {}; }

    const parsed = payoutProvider.parseWebhook(body);
    if (!parsed.outcome) {
      // acknowledge unknown events so the provider stops retrying them
      return res.status(200).json(success({ ignored: true, event: parsed.event }, { message: 'Event ignored' }));
    }

    const result = await payoutService.applyProviderEvent({
      idempotencyKey: parsed.idempotencyKey,
      providerRef: parsed.providerRef,
      outcome: parsed.outcome,
      utr: parsed.utr,
      failureReason: parsed.failureReason,
    });
    return res.status(200).json(success(result, { message: 'Webhook processed' }));
  });

  reviewKyc = asyncHandler(async (req, res) => {
    const account = await VendorPayoutAccount.findOne({ vendorId: req.params.id, isDefault: true });
    if (!account) throw notFound('Vendor payout account not found', 'PAYOUT_NO_ACCOUNT');
    if (req.body.status === 'rejected' && !req.body.rejectionReason) {
      throw badRequest('A rejection reason is required', 'REASON_REQUIRED');
    }
    account.kyc.status = req.body.status === 'approved' ? KYC_STATUS.APPROVED : KYC_STATUS.REJECTED;
    account.kyc.reviewedBy = req.auth.userId;
    account.kyc.reviewedAt = new Date();
    account.kyc.rejectionReason = req.body.rejectionReason || null;
    await account.save();

    await auditService.record({
      action: AUDIT_ACTION.KYC_REVIEW, entityType: 'vendor_payout_account', entityId: account._id,
      actorId: req.auth.userId, actorType: 'admin',
      after: { status: account.kyc.status, reason: account.kyc.rejectionReason }, req,
    }).catch(() => {});

    res.status(200).json(success(account, { message: `KYC ${account.kyc.status}` }));
  });
}

export default new PayoutController();
