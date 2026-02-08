import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password utilities', () => {
  const originalEnv = process.env.BCRYPT_ROUNDS;

  afterEach(() => {
    // Restore original environment
    if (originalEnv) {
      process.env.BCRYPT_ROUNDS = originalEnv;
    } else {
      delete process.env.BCRYPT_ROUNDS;
    }
  });

  describe('hashPassword', () => {
    it('should return a bcrypt hash', async () => {
      const plain = 'mySecurePassword123';
      const hash = await hashPassword(plain);

      // Bcrypt hashes start with $2a$, $2b$, or $2y$
      expect(hash).toMatch(/^\$2[aby]\$/);
    });

    it('should use at least 10 rounds by default', async () => {
      delete process.env.BCRYPT_ROUNDS;
      const plain = 'testPassword';
      const hash = await hashPassword(plain);

      // Extract rounds from hash (format: $2b$10$...)
      const rounds = parseInt(hash.split('$')[2], 10);
      expect(rounds).toBeGreaterThanOrEqual(10);
    });

    it('should respect BCRYPT_ROUNDS environment variable', async () => {
      process.env.BCRYPT_ROUNDS = '12';
      const plain = 'testPassword';
      const hash = await hashPassword(plain);

      const rounds = parseInt(hash.split('$')[2], 10);
      expect(rounds).toBe(12);
    });

    it('should enforce minimum 10 rounds even if lower value is set', async () => {
      process.env.BCRYPT_ROUNDS = '5';
      const plain = 'testPassword';
      const hash = await hashPassword(plain);

      const rounds = parseInt(hash.split('$')[2], 10);
      expect(rounds).toBe(10);
    });

    it('should generate different hashes for the same password', async () => {
      const plain = 'samePassword';
      const hash1 = await hashPassword(plain);
      const hash2 = await hashPassword(plain);

      // Same password should produce different hashes due to salt
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('should return true for matching password', async () => {
      const plain = 'correctPassword123';
      const hash = await hashPassword(plain);

      const result = await verifyPassword(plain, hash);
      expect(result).toBe(true);
    });

    it('should return false for non-matching password', async () => {
      const plain = 'correctPassword123';
      const hash = await hashPassword(plain);

      const result = await verifyPassword('wrongPassword', hash);
      expect(result).toBe(false);
    });

    it('should handle empty passwords correctly', async () => {
      const plain = '';
      const hash = await hashPassword(plain);

      const correctResult = await verifyPassword('', hash);
      const wrongResult = await verifyPassword('notEmpty', hash);

      expect(correctResult).toBe(true);
      expect(wrongResult).toBe(false);
    });
  });
});
