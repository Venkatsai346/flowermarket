/**
 * Haptic feedback — thin wrapper around the Vibration API.
 *
 * Falls back to no-op on desktop / unsupported browsers.
 * Three patterns: light (tap), medium (success), heavy (error).
 *
 * Usage:
 *   import { haptic } from '../lib/haptics.js';
 *   haptic('light');   // button tap
 *   haptic('medium');  // action success
 *   haptic('heavy');   // error / destructive action
 */

const PATTERNS = {
  light: [10],           // short tap
  medium: [20],          // success confirmation
  heavy: [30, 50, 30],   // error / warning
  success: [10, 30, 10], // double tap
  error: [50, 100, 50],  // strong double
};

export function haptic(pattern = 'light') {
  if (!navigator?.vibrate) return;
  try {
    const p = PATTERNS[pattern] || PATTERNS.light;
    navigator.vibrate(p);
  } catch {
    // Silently fail — vibration is non-critical
  }
}

export function cancelHaptic() {
  if (!navigator?.vibrate) return;
  try { navigator.vibrate(0); } catch { /* */ }
}
