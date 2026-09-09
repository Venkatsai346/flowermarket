import { describe, it, expect } from 'vitest';
import { generateToken } from '../src/middleware/csrf.js';
import { BoundedCache } from '../src/utils/BoundedCache.js';

/**
 * Security headers and middleware smoke tests.
 * Verifies security-critical behavior without requiring a running server.
 */
describe('Security hardening', () => {
  describe('CSRF token generation', () => {
    it('should generate cryptographically random tokens', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateToken());
      }
      // All 100 should be unique
      expect(tokens.size).toBe(100);
    });

    it('should generate tokens of consistent length', () => {
      for (let i = 0; i < 10; i++) {
        expect(generateToken()).toHaveLength(64);
      }
    });
  });

  describe('BoundedCache prevents memory exhaustion', () => {
    it('should never exceed maxEntries', () => {
      const cache = new BoundedCache({ maxEntries: 50, ttlMs: 60000 });
      for (let i = 0; i < 200; i++) {
        cache.set(`key-${i}`, `value-${i}`);
      }
      expect(cache.size).toBeLessThanOrEqual(50);
    });

    it('should track eviction count', () => {
      const cache = new BoundedCache({ maxEntries: 10, ttlMs: 60000 });
      for (let i = 0; i < 25; i++) {
        cache.set(`key-${i}`, i);
      }
      expect(cache.stats().evictions).toBe(15); // 25 - 10 = 15 evictions
    });
  });

  describe('Error handling patterns', () => {
    it('AppError should have isOperational flag', async () => {
      const { AppError } = await import('../src/utils/ApiError.js');
      const err = new AppError('test', { status: 400, code: 'TEST' });
      expect(err.isOperational).toBe(true);
      expect(err.status).toBe(400);
      expect(err.code).toBe('TEST');
    });

    it('error factories should create correct status codes', async () => {
      const { badRequest, unauthorized, forbidden, notFound, conflict, tooMany } = await import('../src/utils/ApiError.js');
      expect(badRequest().status).toBe(400);
      expect(unauthorized().status).toBe(401);
      expect(forbidden().status).toBe(403);
      expect(notFound().status).toBe(404);
      expect(conflict().status).toBe(409);
      expect(tooMany().status).toBe(429);
    });
  });

  describe('Configuration validation', () => {
    it('should have all required config sections', async () => {
      const { default: config } = await import('../src/config/index.js');
      expect(config.jwt).toBeDefined();
      expect(config.jwt.accessSecret).toBeDefined();
      expect(config.mongoUri).toBeDefined();
      expect(config.payments).toBeDefined();
      expect(config.redis).toBeDefined();
      expect(config.storage).toBeDefined();
      expect(config.search).toBeDefined();
      expect(config.domains).toBeDefined();
    });

    it('should have proper environment flags', async () => {
      const { default: config } = await import('../src/config/index.js');
      expect(typeof config.isDev).toBe('boolean');
      expect(typeof config.isProd).toBe('boolean');
      expect(typeof config.isTest).toBe('boolean');
    });
  });

  describe('Account lockout isolation', () => {
    it('should isolate lockouts by purpose+tenant+target', async () => {
      const { recordFailure, clearFailures, isLocked } = await import('../src/middleware/accountLockout.js');
      const k1 = 'login:store-a:alice@example.com';
      const k2 = 'login:store-b:alice@example.com';
      const k3 = 'otp_verify:store-a:alice@example.com';

      // Lock out alice in store-a login
      for (let i = 0; i < 10; i++) recordFailure(k1, { maxAttempts: 10 });
      expect(isLocked(k1)).toBe(true);
      expect(isLocked(k2)).toBe(false); // different store
      expect(isLocked(k3)).toBe(false); // different purpose

      clearFailures(k1);
      expect(isLocked(k1)).toBe(false);
    });
  });
});
