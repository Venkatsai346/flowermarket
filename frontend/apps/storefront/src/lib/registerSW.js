/**
 * Register the service worker for PWA support.
 * Only registers in production builds — Vite's HMR needs a live connection.
 */
export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return; // skip in dev

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Check for updates every 60 minutes
        setInterval(() => reg.update(), 60 * 60 * 1000);

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              // Notify the user a new version is available
              if (typeof window !== 'undefined' && window.__bloomy_notifyUpdate) {
                window.__bloomy_notifyUpdate();
              }
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });
  });
}

export default registerServiceWorker;
