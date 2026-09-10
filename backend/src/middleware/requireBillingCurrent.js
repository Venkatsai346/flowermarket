import { paymentRequired } from '../utils/ApiError.js';

/**
 * Block money-taking when the store's subscription is past_due.
 *
 * Mounted on POST /cart/checkout (alongside requireActiveTenant): a store that
 * owes the platform cannot take NEW customer money until it settles. Browsing,
 * carts and quotes are deliberately unaffected — dunning should convert, not
 * confuse — and stores with NO subscription at all (legacy/seed tenants that
 * predate marketplace billing) fail OPEN: only an explicit `past_due` blocks.
 *
 * One indexed read per checkout; the subscription row is tiny and hot.
 */
export async function requireBillingCurrent(req, res, next) {
  try {
    if (!req.tenantId) return next();
    const { default: TenantSubscription } = await import('../models/tenantSubscription.model.js');
    const sub = await TenantSubscription.findOne({
      tenantId: req.tenantId,
      status: { $in: ['trial', 'active', 'past_due'] },
    }).select('status periodEnd').lean();
    if (sub?.status === 'past_due') {
      return next(paymentRequired(
        'This store has an overdue platform invoice — checkout resumes once it is settled',
        'SUBSCRIPTION_PAST_DUE',
        { subscriptionStatus: sub.status }
      ));
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

export default requireBillingCurrent;
