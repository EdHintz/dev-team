import jwt from 'jsonwebtoken';
import type { AuthPayload } from '../types/auth-types.js';

/**
 * Get JWT secret from environment variable
 * Throws an error if JWT_SECRET is not set
 */
const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is not set. ' +
      'This is required for token generation and validation. ' +
      'Please set JWT_SECRET in your environment or .env file.'
    );
  }

  return secret;
};

/**
 * Get JWT expiry from environment or use default
 */
const getJwtExpiry = (): string => {
  return process.env.JWT_EXPIRY || '24h';
};

/**
 * Generate a JWT token with user payload
 * @param payload - The user data to include in the token (userId and email)
 * @returns A signed JWT token string
 * @throws Error if JWT_SECRET is not set
 */
export const generateToken = (payload: AuthPayload): string => {
  const secret = getJwtSecret();
  const expiry = getJwtExpiry();

  // TypeScript has issues with the string literal type, so we cast to any for the options
  return jwt.sign(payload, secret, {
    expiresIn: expiry
  } as any);
};

/**
 * Verify and decode a JWT token
 * @param token - The JWT token string to verify
 * @returns The decoded AuthPayload
 * @throws Error if JWT_SECRET is not set, token is invalid, or token is expired
 */
export const verifyToken = (token: string): AuthPayload => {
  const secret = getJwtSecret();

  try {
    const decoded = jwt.verify(token, secret) as AuthPayload;
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw error;
  }
};
