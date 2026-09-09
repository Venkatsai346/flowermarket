/**
 * TOTP (Time-based One-Time Password) service — RFC 6238.
 *
 * Zero external dependencies: uses Node.js built-in `crypto` for HMAC-SHA1.
 * Designed for super_admin 2FA enrollment and verification.
 *
 * Flow:
 *   1. Super admin calls POST /auth/2fa/enroll → gets secret + otpauth URI
 *   2. Super admin scans QR code (or copies URI into authenticator app)
 *   3. Super admin calls POST /auth/2fa/verify with a 6-digit code
 *   4. On success, `twoFactorEnabled` is set to `true` on the user record
 *   5. Subsequent logins for super_admin require a `twoFactorCode` field
 *
 * The secret is stored encrypted (AES-256-GCM) in the user document.
 * Backup codes are generated at enrollment time and stored hashed (SHA-256).
 */

import crypto from 'crypto';
import config from '../config/index.js';

// ─── helpers ───

/** Generate a random Base32-encoded secret (20 bytes → 32 Base32 chars). */
function generateSecret() {
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

/** Encode a Buffer to Base32 (RFC 4648). */
function base32Encode(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    result += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  }
  return result;
}

/** Decode Base32 string to Buffer. */
function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of cleaned) {
    const val = alphabet.indexOf(ch);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** Compute HMAC-SHA1 for TOTP. */
function hmacSha1(key, counter) {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  return crypto.createHmac('sha1', key).update(counterBuf).digest();
}

/** Dynamic truncation → 6-digit code. */
function truncate(hash) {
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(binary % 10 ** 6).padStart(6, '0');
}

/** Generate TOTP code for a given time step. */
function generateCode(secretBase32, timeStep) {
  const key = base32Decode(secretBase32);
  return truncate(hmacSha1(key, timeStep));
}

/** Get the current time step (30-second window). */
function currentStep(window = 0) {
  return Math.floor(Date.now() / 1000 / 30) + window;
}

// ─── encrypt/decrypt secret for storage ───

const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getEncryptionKey() {
  // Derive a 32-byte key from the JWT access secret (or a dedicated TOTP_SECRET)
  const secret = process.env.TOTP_SECRET || config.jwt.accessSecret || 'fallback-dev-key';
  return crypto.scryptSync(secret, 'totp-encryption-salt', 32);
}

function encryptSecret(plainText) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv(12) + tag(16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptSecret(encoded) {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

// ─── backup codes ───

function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    // 8-char alphanumeric code, easy to type
    codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  return codes;
}

function hashBackupCode(code) {
  return crypto.createHash('sha256').update(code.toUpperCase().trim()).digest('hex');
}

// ─── public API ───

/**
 * Enroll a user in TOTP 2FA.
 * Returns the plaintext secret, otpauth URI, and backup codes.
 * The caller MUST store the encrypted secret and hashed backup codes on the user document.
 */
export function enroll(userId, email) {
  const secret = generateSecret();
  const encryptedSecret = encryptSecret(secret);
  const issuer = encodeURIComponent('Bloomy');
  const account = encodeURIComponent(email || `user-${userId}`);
  const otpauthUri = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

  const backupCodes = generateBackupCodes();
  const hashedBackupCodes = backupCodes.map((c) => hashBackupCode(c));

  return {
    secret, // plaintext — show to user ONCE, then discard from memory
    encryptedSecret, // store on user document
    otpauthUri, // for QR code generation on the frontend
    backupCodes, // plaintext — show to user ONCE
    hashedBackupCodes, // store on user document
  };
}

/**
 * Verify a 6-digit TOTP code.
 * Checks the current window ±1 step (90-second window) to account for clock drift.
 *
 * @param {string} encryptedSecret — the encrypted secret from the user document
 * @param {string} code — 6-digit code from the authenticator app
 * @returns {boolean}
 */
export function verify(encryptedSecret, code) {
  if (!encryptedSecret || !code) return false;
  const normalizedCode = String(code).replace(/\D/g, '').padStart(6, '0');

  try {
    const secret = decryptSecret(encryptedSecret);
    // Check current window ±1 (3 steps total = 90 seconds tolerance)
    for (let w = -1; w <= 1; w += 1) {
      const expected = generateCode(secret, currentStep(w));
      if (crypto.timingSafeEqual(Buffer.from(normalizedCode), Buffer.from(expected))) {
        return true;
      }
    }
  } catch {
    // Decryption failure → reject
    return false;
  }
  return false;
}

/**
 * Verify a backup code. Returns the index of the used code if valid, or -1.
 *
 * @param {string[]} hashedCodes — array of SHA-256 hashed backup codes
 * @param {string} code — plaintext backup code from the user
 * @returns {number} index of the matched code, or -1 if invalid
 */
export function verifyBackupCode(hashedCodes, code) {
  if (!Array.isArray(hashedCodes) || !code) return -1;
  const hash = hashBackupCode(code);
  return hashedCodes.findIndex((h) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
    } catch {
      return false;
    }
  });
}

/**
 * Generate the otpauth URI for QR code rendering.
 */
export function getOtpauthUri(secret, email) {
  const issuer = encodeURIComponent('Bloomy');
  const account = encodeURIComponent(email || 'user');
  return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export default { enroll, verify, verifyBackupCode, getOtpauthUri };
