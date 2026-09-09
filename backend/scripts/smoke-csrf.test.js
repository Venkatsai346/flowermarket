import { describe, it, expect } from 'vitest';
import { generateToken, csrfProtection } from '../src/middleware/csrf.js';

/**
 * CSRF middleware unit tests.
 */
describe('CSRF middleware', () => {
  describe('generateToken', () => {
    it('should generate a 64-char hex string', () => {
      const token = generateToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate unique tokens', () => {
      const t1 = generateToken();
      const t2 = generateToken();
      expect(t1).not.toBe(t2);
    });
  });

  describe('csrfProtection', () => {
    /**
     * Mock req/res that properly simulates cookie read/write.
     * Uses a mutable state object so assertions see post-middleware values.
     */
    function mockReqRes(method = 'GET', headers = {}, cookies = {}) {
      const cookieStore = { ...cookies };
      const state = { statusCode: 200, body: null };
      const req = {
        method,
        headers: { ...headers },
        cookies: cookieStore,
        path: '/api/v1/test',
        originalUrl: '/api/v1/test',
        ip: '127.0.0.1',
      };
      const res = {
        status(code) { state.statusCode = code; return res; },
        json(body) { state.body = body; return res; },
        cookie(name, value) { cookieStore[name] = value; },
        getHeader() {},
        setHeader() {},
      };
      return { req, res, state, cookieStore };
    }

    it('should pass GET requests without validation', () => {
      const { req, res } = mockReqRes('GET');
      let called = false;
      csrfProtection(req, res, () => { called = true; });
      expect(called).toBe(true);
    });

    it('should pass HEAD requests without validation', () => {
      const { req, res } = mockReqRes('HEAD');
      let called = false;
      csrfProtection(req, res, () => { called = true; });
      expect(called).toBe(true);
    });

    it('should pass webhook endpoints without validation', () => {
      const { req, res } = mockReqRes('POST', {}, {});
      req.path = '/api/v1/payments/webhook/razorpay';
      req.originalUrl = '/api/v1/payments/webhook/razorpay';
      let called = false;
      csrfProtection(req, res, () => { called = true; });
      expect(called).toBe(true);
    });

    it('should pass auth endpoints without validation', () => {
      const { req, res } = mockReqRes('POST', {}, {});
      req.path = '/api/v1/auth/login';
      req.originalUrl = '/api/v1/auth/login';
      let called = false;
      csrfProtection(req, res, () => { called = true; });
      expect(called).toBe(true);
    });

    it('should reject POST without CSRF header', () => {
      const { req, res, state } = mockReqRes('POST', {}, { 'csrf-token': 'valid-token' });
      csrfProtection(req, res, () => {});
      expect(state.statusCode).toBe(403);
      expect(state.body.code).toBe('CSRF_FAILED');
    });

    it('should reject POST with mismatched CSRF token', () => {
      const { req, res, state } = mockReqRes('POST', {
        'x-csrf-token': 'wrong-token',
      }, { 'csrf-token': 'valid-token' });
      csrfProtection(req, res, () => {});
      expect(state.statusCode).toBe(403);
    });

    it('should pass POST with matching CSRF token', () => {
      const token = 'test-token-123';
      const { req, res, state } = mockReqRes('POST', {
        'x-csrf-token': token,
      }, { 'csrf-token': token });
      let called = false;
      csrfProtection(req, res, () => { called = true; });
      expect(called).toBe(true);
      expect(state.statusCode).toBe(200);
    });

    it('should pass requests with API key (no cookie needed)', () => {
      const { req, res } = mockReqRes('POST', {
        'x-api-key': 'some-api-key',
      }, {});
      let called = false;
      csrfProtection(req, res, () => { called = true; });
      expect(called).toBe(true);
    });

    it('should set CSRF cookie if not present', () => {
      const { req, res, cookieStore } = mockReqRes('GET', {}, {});
      csrfProtection(req, res, () => {});
      expect(cookieStore['csrf-token']).toBeTruthy();
      expect(cookieStore['csrf-token']).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should not overwrite existing CSRF cookie', () => {
      const existing = 'a'.repeat(64);
      const { req, res, cookieStore } = mockReqRes('GET', {}, { 'csrf-token': existing });
      csrfProtection(req, res, () => {});
      expect(cookieStore['csrf-token']).toBe(existing);
    });
  });
});
