import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth, optionalAuth } from './auth-middleware.js';
import { generateToken } from '../utils/jwt.js';
import type { AuthPayload } from '../types/auth-types.js';

// Mock response object
const createMockResponse = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  } as unknown as Response;
  return res;
};

// Mock next function
const createMockNext = () => vi.fn() as NextFunction;

describe('auth-middleware', () => {
  const testPayload: AuthPayload = {
    userId: 1,
    email: 'test@example.com'
  };

  beforeEach(() => {
    // Set JWT_SECRET for tests
    process.env.JWT_SECRET = 'test-secret-key-for-testing';
  });

  describe('requireAuth', () => {
    it('should return 401 if no token is provided', () => {
      const req = {
        cookies: {},
        headers: {}
      } as unknown as Request;
      const res = createMockResponse();
      const next = createMockNext();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        message: 'No token provided'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if token is invalid', () => {
      const req = {
        cookies: { token: 'invalid-token' },
        headers: {}
      } as unknown as Request;
      const res = createMockResponse();
      const next = createMockNext();

      requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication failed',
        message: 'Invalid token'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if token is expired', () => {
      // Generate a token with immediate expiry
      process.env.JWT_EXPIRY = '0s';
      const expiredToken = generateToken(testPayload);
      process.env.JWT_EXPIRY = '24h';

      const req = {
        cookies: { token: expiredToken },
        headers: {}
      } as unknown as Request;
      const res = createMockResponse();
      const next = createMockNext();

      // Wait a tiny bit to ensure token is expired
      setTimeout(() => {
        requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Authentication failed',
          message: 'Token has expired'
        });
        expect(next).not.toHaveBeenCalled();
      }, 100);
    });

    it('should attach user to req and call next() with valid token from cookie', () => {
      const token = generateToken(testPayload);
      const req = {
        cookies: { token },
        headers: {}
      } as unknown as Request;
      const res = createMockResponse();
      const next = createMockNext();

      requireAuth(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user?.userId).toBe(testPayload.userId);
      expect(req.user?.email).toBe(testPayload.email);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should attach user to req and call next() with valid token from Authorization header', () => {
      const token = generateToken(testPayload);
      const req = {
        cookies: {},
        headers: { authorization: `Bearer ${token}` }
      } as unknown as Request;
      const res = createMockResponse();
      const next = createMockNext();

      requireAuth(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user?.userId).toBe(testPayload.userId);
      expect(req.user?.email).toBe(testPayload.email);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should prioritize cookie over Authorization header', () => {
      const token = generateToken(testPayload);
      const differentPayload: AuthPayload = {
        userId: 999,
        email: 'different@example.com'
      };
      const differentToken = generateToken(differentPayload);

      const req = {
        cookies: { token },
        headers: { authorization: `Bearer ${differentToken}` }
      } as unknown as Request;
      const res = createMockResponse();
      const next = createMockNext();

      requireAuth(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user?.userId).toBe(testPayload.userId);
      expect(req.user?.email).toBe(testPayload.email);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('optionalAuth', () => {
    it('should call next() without attaching user if no token is provided', () => {
      const req = {
        cookies: {},
        headers: {}
      } as unknown as Request;
      const res = createMockResponse();
      const next = createMockNext();

      optionalAuth(req, res, next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should call next() without attaching user if token is invalid', () => {
      const req = {
        cookies: { token: 'invalid-token' },
        headers: {}
      } as unknown as Request;
      const res = createMockResponse();
      const next = createMockNext();

      optionalAuth(req, res, next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should attach user to req and call next() with valid token from cookie', () => {
      const token = generateToken(testPayload);
      const req = {
        cookies: { token },
        headers: {}
      } as unknown as Request;
      const res = createMockResponse();
      const next = createMockNext();

      optionalAuth(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user?.userId).toBe(testPayload.userId);
      expect(req.user?.email).toBe(testPayload.email);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should attach user to req and call next() with valid token from Authorization header', () => {
      const token = generateToken(testPayload);
      const req = {
        cookies: {},
        headers: { authorization: `Bearer ${token}` }
      } as unknown as Request;
      const res = createMockResponse();
      const next = createMockNext();

      optionalAuth(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user?.userId).toBe(testPayload.userId);
      expect(req.user?.email).toBe(testPayload.email);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
