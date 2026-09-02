import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { unauthorized } from './ApiError.js';

/**
 * TokenService — issues & verifies JWT access tokens.
 * Refresh tokens are opaque (see AuthToken model) — the JWT only ever carries
 * the short-lived access credential.
 */
class TokenService {
  constructor(cfg) {
    this.cfg = cfg;
  }

  /** Sign an access token for a user. */
  signAccessToken({ userId, tenantId, role }) {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        sub: userId, // subject = user id (JWT standard claim)
        tenant: tenantId,
        role,
        iat: now,
      },
      this.cfg.accessSecret,
      {
        expiresIn: this.cfg.accessTtlSeconds,
        issuer: this.cfg.issuer,
        audience: this.cfg.audience,
      }
    );
  }

  /**
   * Verify + decode an access token.
   * Returns the payload; throws 401 (with reason) on any failure so the
   * auth middleware can produce consistent errors.
   */
  verifyAccessToken(token) {
    try {
      return jwt.verify(token, this.cfg.accessSecret, {
        issuer: this.cfg.issuer,
        audience: this.cfg.audience,
      });
    } catch (err) {
      const reason = err?.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
      throw unauthorized(err.message, reason);
    }
  }
}

export default new TokenService(config.jwt);
