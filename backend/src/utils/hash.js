import crypto from 'node:crypto';

/** SHA-256 hex digest — used for refresh tokens & OTPs at rest. */
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Random numeric OTP / verification code. */
export function generateNumericCode(length = 6) {
  const max = 10 ** length;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(length, '0');
}

/** Random opaque token (e.g. refresh token seed). */
export function generateOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Masked display value: '98765' -> '987**' (keeps prefix only). */
export function maskCode(code) {
  if (!code) return null;
  return `${String(code).slice(0, 2)}${'*'.repeat(Math.max(0, String(code).length - 2))}`;
}

/** Constant-time string compare (avoids timing side-channels on OTP checks). */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
