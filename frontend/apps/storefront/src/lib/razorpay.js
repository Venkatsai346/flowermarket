/**
 * Razorpay Standard Checkout — load Checkout.js once, never without a keyId.
 *
 * The webhook is the source of truth; `onSuccess` only starts polling.
 * Never send the key secret to the browser.
 */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const FALLBACK_BRAND = '#e11d48';

/** CSS `--brand` when it is a hex colour; otherwise the classic rose. */
export function brandColorFromCss(style) {
  const raw = String(
    (style && typeof style.getPropertyValue === 'function' && style.getPropertyValue('--brand'))
      || '',
  ).trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(raw) ? raw : FALLBACK_BRAND;
}

/** Restrict Checkout.js to the method the customer already picked. */
export function razorpayMethodFilter(method) {
  if (method === 'upi') {
    return { upi: true, card: false, netbanking: false, wallet: false, emi: false, paylater: false };
  }
  if (method === 'card') {
    return { upi: false, card: true, netbanking: false, wallet: false, emi: false, paylater: false };
  }
  return undefined;
}

export function buildRazorpayOptions({
  keyId,
  gatewayOrderId,
  amountPaise,
  currency = 'INR',
  name,
  description,
  customer = {},
  method,
  themeColor,
  notes,
} = {}) {
  const opts = {
    key: keyId,
    amount: amountPaise,
    currency,
    name: name || 'Flower Market',
    description: description || 'Order payment',
    order_id: gatewayOrderId,
    prefill: {
      name: customer.name || '',
      email: customer.email || '',
      contact: customer.contact || '',
    },
    theme: { color: themeColor || FALLBACK_BRAND },
  };
  const filter = razorpayMethodFilter(method);
  if (filter) opts.method = filter;
  if (notes && typeof notes === 'object') opts.notes = notes;
  return opts;
}

/**
 * Inject Checkout.js only when a publishable key is present.
 * Mock / e2e (no keyId) must never hit checkout.razorpay.com.
 */
export function loadRazorpay(keyId) {
  if (!keyId) return Promise.reject(new Error('Razorpay key missing'));
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-fm-razorpay]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Razorpay));
      existing.addEventListener('error', () => reject(new Error('Razorpay failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.dataset.fmRazorpay = '1';
    s.onload = () => resolve(window.Razorpay);
    s.onerror = () => reject(new Error('Razorpay failed to load'));
    document.body.appendChild(s);
  });
}

/**
 * Open Razorpay Checkout. Returns false (and loads nothing) without a keyId.
 */
export async function openRazorpayCheckout({
  keyId, gatewayOrderId, amountPaise, currency = 'INR',
  name, description, customer = {}, method, notes,
  onSuccess, onDismiss,
} = {}) {
  if (!keyId || !gatewayOrderId) return false;
  const themeColor = typeof window !== 'undefined'
    ? brandColorFromCss(window.getComputedStyle?.(document.documentElement))
    : FALLBACK_BRAND;
  const Razorpay = await loadRazorpay(keyId);
  return new Promise((resolve) => {
    const rzp = new Razorpay({
      ...buildRazorpayOptions({
        keyId, gatewayOrderId, amountPaise, currency, name, description, customer, method, themeColor, notes,
      }),
      handler: () => {
        onSuccess?.();
        resolve(true);
      },
      modal: {
        ondismiss: () => {
          onDismiss?.();
          resolve(false);
        },
      },
    });
    rzp.open();
  });
}
