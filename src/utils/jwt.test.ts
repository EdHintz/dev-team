import { describe, it, expect } from 'vitest';
import { generateToken, verifyToken } from './jwt';
import type { AuthPayload } from '../types/auth-types';

describe('JWT Utilities', () => {
  const testPayload: AuthPayload = {
    userId: 1,
    email: 'test@example.com'
  };

  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateToken(testPayload);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      // JWT format: header.payload.signature (3 parts separated by dots)
      expect(token.split('.').length).toBe(3);
    });

    it('should include user data in token payload', () => {
      const token = generateToken(testPayload);
      const decoded = verifyToken(token);

      expect(decoded.userId).toBe(testPayload.userId);
      expect(decoded.email).toBe(testPayload.email);
    });

    it('should generate a token with correct payload data', () => {
      const token = generateToken(testPayload);
      const decoded = verifyToken(token);

      // Check that decoded payload includes our data
      expect(decoded.userId).toBe(testPayload.userId);
      expect(decoded.email).toBe(testPayload.email);
      // JWT library adds iat and exp fields
      expect(decoded).toHaveProperty('iat');
      expect(decoded).toHaveProperty('exp');
    });
  });

  describe('verifyToken', () => {
    it('should verify and decode a valid token', () => {
      const token = generateToken(testPayload);
      const decoded = verifyToken(token);

      expect(decoded.userId).toBe(testPayload.userId);
      expect(decoded.email).toBe(testPayload.email);
    });

    it('should throw error for invalid token', () => {
      const invalidToken = 'invalid.token.here';

      expect(() => {
        verifyToken(invalidToken);
      }).toThrow('Invalid token');
    });

    it('should throw error for tampered token', () => {
      const token = generateToken(testPayload);
      const parts = token.split('.');
      // Modify the payload
      parts[1] = Buffer.from('{"userId": 999, "email": "hacker@example.com"}').toString('base64');
      const tamperedToken = parts.join('.');

      expect(() => {
        verifyToken(tamperedToken);
      }).toThrow('Invalid token');
    });

    it('should throw error for expired token', () => {
      // Set expiry to a very short time
      const originalEnv = process.env.JWT_EXPIRY;
      process.env.JWT_EXPIRY = '1ms';

      const token = generateToken(testPayload);

      // Wait longer than expiry time
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(() => {
            verifyToken(token);
          }).toThrow('Token has expired');

          // Restore original expiry
          process.env.JWT_EXPIRY = originalEnv;
          resolve();
        }, 50);
      });
    });

    it('should throw error for malformed token', () => {
      const malformedToken = 'not.a.valid.jwt';

      expect(() => {
        verifyToken(malformedToken);
      }).toThrow('Invalid token');
    });

    it('should throw error for empty string', () => {
      expect(() => {
        verifyToken('');
      }).toThrow('Invalid token');
    });
  });
});
