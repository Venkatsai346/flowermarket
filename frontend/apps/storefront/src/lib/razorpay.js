/** Load Checkout.js once. Missing in mock mode — callers must no-op without a key. */
export function loadRazorpay() {
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
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.dataset.fmRazorpay = '1';
    s.onload = () => resolve(window.Razorpay);
    s.onerror = () => reject(new Error('Razorpay failed to load'));
    document.body.appendChild(s);
  });
}

/**
 * Open Razorpay Checkout. The webhook is the source of truth; `onSuccess`
 * just starts polling. Never send the key secret to the browser.
 */
export async function openRazorpayCheckout({
  keyId, gatewayOrderId, amountPaise, currency = 'INR',
  name, description, customer = {}, onSuccess, onDismiss,
}) {
  if (!keyId || !gatewayOrderId) return false;
  const Razorpay = await loadRazorpay();
  return new Promise((resolve) => {
    const rzp = new Razorpay({
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
      theme: { color: '#e11d48' },
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
