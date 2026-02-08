import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('Password Utilities', () => {
  describe('hashPassword', () => {
    it('should produce a valid bcrypt hash', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);

      // Bcrypt hashes start with $2a$, $2b$, or $2y$ followed by cost factor
      expect(hash).toMatch(/^\$2[aby]\$/);
      // Bcrypt hashes are always 60 characters long
      expect(hash).toHaveLength(60);
    });

    it('should produce different hashes for the same password', async () => {
      const password = 'testPassword123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      // Each hash should be different (due to random salt)
      expect(hash1).not.toBe(hash2);
    });

    it('should handle long passwords', async () => {
      const longPassword = 'a'.repeat(100);
      const hash = await hashPassword(longPassword);

      expect(hash).toMatch(/^\$2[aby]\$/);
      expect(hash).toHaveLength(60);
    });
  });

  describe('verifyPassword', () => {
    it('should return true when password matches hash', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);

      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('should return false when password does not match hash', async () => {
      const correctPassword = 'testPassword123';
      const wrongPassword = 'wrongPassword456';
      const hash = await hashPassword(correctPassword);

      const result = await verifyPassword(wrongPassword, hash);
      expect(result).toBe(false);
    });

    it('should return false for empty password against hash', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);

      const result = await verifyPassword('', hash);
      expect(result).toBe(false);
    });

    it('should be case-sensitive', async () => {
      const password = 'TestPassword123';
      const hash = await hashPassword(password);

      const result = await verifyPassword('testpassword123', hash);
      expect(result).toBe(false);
    });
  });
});
