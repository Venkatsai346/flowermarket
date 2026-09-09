/**
 * CurrencyService — multi-currency support for international expansion.
 *
 * Stores exchange rates and converts prices between currencies.
 * Base currency is INR (Indian Rupee) — all internal calculations
 * remain in INR paise. Display prices are converted on-the-fly.
 *
 * Usage:
 *   const converted = currencyService.convert(59000, 'INR', 'USD');
 *   const formatted = currencyService.format(converted, 'USD');
 */

const EXCHANGE_RATES = {
  INR: 1,
  USD: 0.012,    // 1 INR ≈ 0.012 USD
  EUR: 0.011,    // 1 INR ≈ 0.011 EUR
  GBP: 0.0095,   // 1 INR ≈ 0.0095 GBP
  AED: 0.044,    // 1 INR ≈ 0.044 AED
  SGD: 0.016,    // 1 INR ≈ 0.016 SGD
  CAD: 0.016,    // 1 INR ≈ 0.016 CAD
  AUD: 0.018,    // 1 INR ≈ 0.018 AUD
};

const CURRENCY_SYMBOLS = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£',
  AED: 'د.إ', SGD: 'S$', CAD: 'C$', AUD: 'A$',
};

const CURRENCY_LOCALES = {
  INR: 'en-IN', USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB',
  AED: 'ar-AE', SGD: 'en-SG', CAD: 'en-CA', AUD: 'en-AU',
};

class CurrencyService {
  /**
   * Convert an amount from one currency to another.
   * Amount is in the smallest unit (paise for INR, cents for USD).
   */
  convert(amountPaise, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return amountPaise;

    const fromRate = EXCHANGE_RATES[fromCurrency];
    const toRate = EXCHANGE_RATES[toCurrency];
    if (!fromRate || !toRate) return amountPaise;

    // Convert to INR first, then to target
    const inINR = amountPaise / fromRate;
    return Math.round(inINR * toRate);
  }

  /**
   * Format a price for display.
   */
  format(amountPaise, currency = 'INR') {
    const symbol = CURRENCY_SYMBOLS[currency] || currency;
    const amount = amountPaise / 100; // Convert from paise/cents to main unit
    const locale = CURRENCY_LOCALES[currency] || 'en-US';

    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: currency === 'INR' ? 0 : 2,
      }).format(amount);
    } catch {
      return `${symbol}${amount.toFixed(2)}`;
    }
  }

  /**
   * Get all supported currencies.
   */
  supported() {
    return Object.keys(EXCHANGE_RATES).map((code) => ({
      code,
      symbol: CURRENCY_SYMBOLS[code],
      rate: EXCHANGE_RATES[code],
    }));
  }

  /**
   * Update exchange rates (called periodically or manually).
   */
  updateRates(rates) {
    Object.assign(EXCHANGE_RATES, rates);
  }

  /**
   * Get current rates.
   */
  getRates() {
    return { ...EXCHANGE_RATES };
  }
}

export default new CurrencyService();
