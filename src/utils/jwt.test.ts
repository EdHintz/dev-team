import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateToken, verifyToken } from './jwt.js';
import type { AuthPayload } from '../types/auth-types.js';

describe('JWT utilities', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalExpiry = process.env.JWT_EXPIRY;

  beforeEach(() => {
    // Set a test secret
    process.env.JWT_SECRET = 'test-secret-key-for-jwt-testing';
  });

  afterEach(() => {
    // Restore original environment
    if (originalSecret) {
      process.env.JWT_SECRET = originalSecret;
    } else {
      delete process.env.JWT_SECRET;
    }

    if (originalExpiry) {
      process.env.JWT_EXPIRY = originalExpiry;
    } else {
      delete process.env.JWT_EXPIRY;
    }
  });

  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const payload: AuthPayload = {
        userId: 1,
        email: 'test@example.com'
      };

      const token = generateToken(payload);

      // JWT format: header.payload.signature
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include userId and email in token payload', () => {
      const payload: AuthPayload = {
        userId: 42,
        email: 'user@example.com'
      };

      const token = generateToken(payload);
      const decoded = verifyToken(token);

      expect(decoded.userId).toBe(42);
      expect(decoded.email).toBe('user@example.com');
    });

    it('should throw error if JWT_SECRET is not set', () => {
      delete process.env.JWT_SECRET;

      const payload: AuthPayload = {
        userId: 1,
        email: 'test@example.com'
      };

      expect(() => generateToken(payload)).toThrow('JWT_SECRET environment variable is not set');
    });

    it('should use custom expiry from environment', () => {
      process.env.JWT_EXPIRY = '1h';

      const payload: AuthPayload = {
        userId: 1,
        email: 'test@example.com'
      };

      const token = generateToken(payload);

      // Verify token is valid
      expect(() => verifyToken(token)).not.toThrow();
    });
  });

  describe('verifyToken', () => {
    it('should verify and decode a valid token', () => {
      const payload: AuthPayload = {
        userId: 123,
        email: 'verify@example.com'
      };

      const token = generateToken(payload);
      const decoded = verifyToken(token);

      expect(decoded.userId).toBe(123);
      expect(decoded.email).toBe('verify@example.com');
    });

    it('should throw error for invalid token', () => {
      const invalidToken = 'invalid.token.here';

      expect(() => verifyToken(invalidToken)).toThrow('Invalid token');
    });

    it('should throw error for malformed token', () => {
      const malformedToken = 'notavalidtoken';

      expect(() => verifyToken(malformedToken)).toThrow('Invalid token');
    });

    it('should throw error for token signed with different secret', () => {
      process.env.JWT_SECRET = 'secret1';
      const payload: AuthPayload = {
        userId: 1,
        email: 'test@example.com'
      };
      const token = generateToken(payload);

      // Change secret
      process.env.JWT_SECRET = 'secret2';

      expect(() => verifyToken(token)).toThrow('Invalid token');
    });

    it('should throw error if JWT_SECRET is not set', () => {
      const payload: AuthPayload = {
        userId: 1,
        email: 'test@example.com'
      };
      const token = generateToken(payload);

      delete process.env.JWT_SECRET;

      expect(() => verifyToken(token)).toThrow('JWT_SECRET environment variable is not set');
    });

    it('should throw error for expired token', async () => {
      process.env.JWT_EXPIRY = '1ms'; // Very short expiry

      const payload: AuthPayload = {
        userId: 1,
        email: 'test@example.com'
      };

      const token = generateToken(payload);

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(() => verifyToken(token)).toThrow('Token has expired');
    });
  });
});
