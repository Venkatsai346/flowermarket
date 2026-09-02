import { generateNumericCode, sha256 } from './hash.js';

/**
 * OtpService — value-level helpers for OTP codes.
 * (Persistence & state live in the OtpVerification collection; this module
 * only generates and hashes codes.)
 */
const otpService = {
  /** Random numeric code of given length. */
  generate(length = 6) {
    return generateNumericCode(length);
  },

  /** SHA-256 of the code — this is what we persist (never plaintext OTPs). */
  hash(code) {
    return sha256(code);
  },
};

export default otpService;
