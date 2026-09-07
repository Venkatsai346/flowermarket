import { useShop } from '../store.js';

export function isAuthError(e) {
  return e?.status === 401
    || e?.code === 'UNAUTHORIZED'
    || e?.code === 'NO_REFRESH_TOKEN'
    || e?.code === 'TOKEN_EXPIRED'
    || e?.code === 'REFRESH_FAILED';
}

/**
 * Run `fn`. If the API 401s, open the OTP sheet and retry once the
 * customer verifies — the add-to-cart they started is not lost.
 */
export function withAuthRetry(fn) {
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        resolve(await fn());
      } catch (e) {
        if (!isAuthError(e)) {
          reject(e);
          return;
        }
        useShop.getState().openAuth({
          retry: async () => {
            try {
              resolve(await fn());
            } catch (err) {
              reject(err);
            }
          },
          onCancel: () => reject(e),
        });
      }
    };
    attempt();
  });
}
