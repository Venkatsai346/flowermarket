/**
 * BillingProvider — invoice payment adapter (Phase 5).
 *
 * Default `console|mock` marks invoices paid deterministically so the whole
 * billing lifecycle is testable without a gateway. A real provider (razorpay
 * payment links / invoices) slots in behind charge() with env config — same
 * adapter-then-keys pattern as razorpay order payments and notification sends.
 */

import config from '../config/index.js';

class BillingProvider {
  /** @returns {Promise<{success: boolean, ref: string|null}>} */
  async charge({ invoiceId, amount, currency = 'INR' }) {
    const provider = config.marketplace.billingProvider;
    if (provider === 'console' || provider === 'mock') {
      // eslint-disable-next-line no-console
      console.log(`[billing:${provider}] invoice ${invoiceId} charged ${currency} ${amount}`);
      return { success: true, ref: `mock_inv_${invoiceId}` };
    }
    if (provider === 'razorpay') {
      // Payment Links API — wire RAZORPAY_KEY_ID/SECRET here
      throw new Error('Razorpay billing adapter: configure credentials before use');
    }
    throw new Error(`Billing provider "${provider}" not implemented`);
  }
}

export default new BillingProvider();
