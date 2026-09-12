import { paymentRequired } from '../utils/ApiError.js';

/**
 * Block money-taking when the store owes the platform.
 *
 * Mounted on POST /cart/checkout (alongside requireActiveTenant): a store that
 * owes the platform cannot take NEW customer money until it settles. Browsing,
 * carts and quotes are deliberately unaffected — dunning should convert, not
 * confuse — and stores with NO subscription at all (legacy/seed tenants that
 * predate marketplace billing) fail OPEN: only an explicit debt blocks.
 *
 * TWO independent trip-wires (either one blocks):
 *   1. the live subscription is `past_due` (written only by
 *      billingService.refreshStanding(), the standing choke point);
 *   2. ANY delinquent invoice exists (OVERDUE, or OPEN past its due date).
 * The second wire is the drift-proofing: even if standing and invoices ever
 * disagree — a cancelled-with-debt row, a pre-hardening row, a missed sweep —
 * the debt itself still blocks. Both reads are tiny indexed exists() probes.
 */
export async function requireBillingCurrent(req, res, next) {
  try {
    if (!req.tenantId) return next();
    const [{ default: TenantSubscription }, { default: Invoice }] = await Promise.all([
      import('../models/tenantSubscription.model.js'),
      import('../models/invoice.model.js'),
    ]);
    const [sub, debt] = await Promise.all([
      TenantSubscription.findOne({
        tenantId: req.tenantId,
        status: { $in: ['trial', 'active', 'past_due'] },
      }).select('status periodEnd').lean(),
      Invoice.exists({
        tenantId: req.tenantId,
        $or: [
          { status: 'overdue' },
          { status: 'open', dueAt: { $lte: new Date() } },
        ],
      }),
    ]);
    if (sub?.status === 'past_due' || debt) {
      return next(paymentRequired(
        'This store has an overdue platform invoice — checkout resumes once it is settled',
        'SUBSCRIPTION_PAST_DUE',
        { subscriptionStatus: sub?.status || null }
      ));
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

export default requireBillingCurrent;
