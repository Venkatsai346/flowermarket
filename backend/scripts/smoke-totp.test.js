import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import totpService from '../src/services/totp.service.js';

/**
 * TOTP service unit tests.
 * Tests enrollment, verification, and backup codes.
 */
describe('TOTP service', () => {
  describe('enroll', () => {
    it('should generate a secret, encrypted secret, URI, and backup codes', () => {
      const result = totpService.enroll('user123', 'test@example.com');

      expect(result.secret).toBeTruthy();
      expect(result.secret.length).toBe(32); // 20 bytes → 32 Base32 chars
      expect(result.encryptedSecret).toBeTruthy();
      expect(result.encryptedSecret).not.toBe(result.secret); // encrypted != plaintext
      expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(result.backupCodes).toHaveLength(8);
      expect(result.hashedBackupCodes).toHaveLength(8);
      // Each backup code is 8 hex chars
      result.backupCodes.forEach((c) => expect(c).toMatch(/^[A-F0-9]{8}$/));
      // Hashed codes are SHA-256 (64 hex chars)
      result.hashedBackupCodes.forEach((h) => expect(h).toMatch(/^[a-f0-9]{64}$/));
    });

    it('should generate unique secrets each time', () => {
      const r1 = totpService.enroll('user1', 'a@test.com');
      const r2 = totpService.enroll('user2', 'b@test.com');
      expect(r1.secret).not.toBe(r2.secret);
      expect(r1.encryptedSecret).not.toBe(r2.encryptedSecret);
    });

    it('should include email in otpauth URI', () => {
      const result = totpService.enroll('user1', 'john@example.com');
      expect(result.otpauthUri).toContain('john%40example.com');
    });
  });

  describe('verify', () => {
    it('should reject null or empty inputs', () => {
      expect(totpService.verify(null, '123456')).toBe(false);
      expect(totpService.verify('encrypted', null)).toBe(false);
      expect(totpService.verify('', '')).toBe(false);
    });

    it('should reject invalid encrypted secret', () => {
      expect(totpService.verify('not-a-valid-secret', '123456')).toBe(false);
    });
  });

  describe('verifyBackupCode', () => {
    it('should return -1 for empty/null inputs', () => {
      expect(totpService.verifyBackupCode([], 'ABCD1234')).toBe(-1);
      expect(totpService.verifyBackupCode(null, 'ABCD1234')).toBe(-1);
      expect(totpService.verifyBackupCode(['hash'], null)).toBe(-1);
    });

    it('should find matching backup code by index', () => {
      const codes = ['ABCD1234', 'EFGH5678', 'IJKL9012'];
      const hashed = codes.map((c) =>
        crypto.createHash('sha256').update(c.toUpperCase()).digest('hex')
      );

      const idx = totpService.verifyBackupCode(hashed, 'EFGH5678');
      expect(idx).toBe(1);
    });

    it('should return -1 for non-matching code', () => {
      const hashed = ['a'.repeat(64)]; // fake hash
      expect(totpService.verifyBackupCode(hashed, 'NOMATCH')).toBe(-1);
    });

    it('should be case-insensitive for backup codes', () => {
      const codes = ['ABCD1234'];
      const hashed = codes.map((c) =>
        crypto.createHash('sha256').update(c).digest('hex')
      );

      expect(totpService.verifyBackupCode(hashed, 'abcd1234')).toBe(0);
      expect(totpService.verifyBackupCode(hashed, 'AbCd1234')).toBe(0);
    });
  });
});
