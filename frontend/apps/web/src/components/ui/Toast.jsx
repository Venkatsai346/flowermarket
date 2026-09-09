/**
 * Toast — thin API for showing toast notifications.
 *
 * Re-exports the existing toast helpers from lib/toasts.js for pages that
 * import { showToast } from '…/Toast.jsx'.
 */
import { toast } from '../../lib/toasts.js';

/** Show a toast notification. */
export function showToast(message, type = 'info') {
  if (type === 'success') return toast.success(message);
  if (type === 'error')   return toast.error(message);
  return toast.info(message);
}

export { toast };
export default toast;
