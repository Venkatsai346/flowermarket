import { describe, it, expect, beforeEach } from 'vitest';
import { recordFailure, clearFailures, isLocked } from '../src/middleware/accountLockout.js';

/**
 * Account lockout unit tests.
 * Tests the in-memory lockout store directly (no HTTP needed).
 */
describe('accountLockout', () => {
  const key = 'test:default:9876543210';

  beforeEach(() => {
    clearFailures(key);
  });

  it('should not be locked initially', () => {
    expect(isLocked(key)).toBe(false);
  });

  it('should lock after maxAttempts failures', () => {
    for (let i = 0; i < 9; i++) {
      const r = recordFailure(key, { maxAttempts: 10, lockoutMinutes: 15 });
      expect(r.locked).toBe(false);
      expect(r.remaining).toBe(10 - i - 1);
    }
    // 10th attempt should lock
    const r = recordFailure(key, { maxAttempts: 10, lockoutMinutes: 15 });
    expect(r.locked).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.lockedUntil).toBeGreaterThan(Date.now());
  });

  it('should report locked state after maxAttempts', () => {
    for (let i = 0; i < 10; i++) {
      recordFailure(key, { maxAttempts: 10, lockoutMinutes: 15 });
    }
    expect(isLocked(key)).toBe(true);
  });

  it('should clear failures on successful login', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure(key, { maxAttempts: 10, lockoutMinutes: 15 });
    }
    clearFailures(key);
    expect(isLocked(key)).toBe(false);
    // Should be able to record failures again from 0
    const r = recordFailure(key, { maxAttempts: 10, lockoutMinutes: 15 });
    expect(r.locked).toBe(false);
    expect(r.remaining).toBe(9);
  });

  it('should extend lock on each attempt while locked', () => {
    for (let i = 0; i < 10; i++) {
      recordFailure(key, { maxAttempts: 10, lockoutMinutes: 15 });
    }
    const r1 = recordFailure(key, { maxAttempts: 10, lockoutMinutes: 15 });
    const r2 = recordFailure(key, { maxAttempts: 10, lockoutMinutes: 15 });
    // Both should report locked
    expect(r1.locked).toBe(true);
    expect(r2.locked).toBe(true);
  });

  it('should isolate keys per tenant and target', () => {
    const key1 = 'otp:tenant1:1111111111';
    const key2 = 'otp:tenant2:1111111111';
    const key3 = 'otp:tenant1:2222222222';

    for (let i = 0; i < 10; i++) {
      recordFailure(key1, { maxAttempts: 10, lockoutMinutes: 15 });
    }
    expect(isLocked(key1)).toBe(true);
    expect(isLocked(key2)).toBe(false); // different tenant
    expect(isLocked(key3)).toBe(false); // different target
  });

  it('should support custom maxAttempts', () => {
    const r1 = recordFailure(key, { maxAttempts: 3, lockoutMinutes: 5 });
    expect(r1.locked).toBe(false);
    const r2 = recordFailure(key, { maxAttempts: 3, lockoutMinutes: 5 });
    expect(r2.locked).toBe(false);
    const r3 = recordFailure(key, { maxAttempts: 3, lockoutMinutes: 5 });
    expect(r3.locked).toBe(true);
  });
});
