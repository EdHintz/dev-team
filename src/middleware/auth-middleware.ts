import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';

/**
 * Extract JWT token from request
 * Checks both HTTP-only cookie and Authorization header
 * @param req - Express request object
 * @returns Token string or null if not found
 */
const extractToken = (req: Request): string | null => {
  // Check HTTP-only cookie first
  if (req.cookies?.token) {
    return req.cookies.token;
  }

  // Check Authorization header for Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7); // Remove 'Bearer ' prefix
  }

  return null;
};

/**
 * Authentication middleware that requires a valid JWT token
 * Returns 401 if token is missing, invalid, or expired
 * Attaches decoded user payload to req.user on success
 */
export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({
      error: 'Authentication required',
      message: 'No token provided'
    });
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid token';
    res.status(401).json({
      error: 'Authentication failed',
      message
    });
  }
};

/**
 * Optional authentication middleware
 * Attaches user to req.user if valid token is present
 * Does NOT fail if token is missing or invalid - just continues without user
 */
export const optionalAuth = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const token = extractToken(req);

  if (!token) {
    // No token present - continue without user
    next();
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
  } catch (error) {
    // Token invalid or expired - continue without user (don't fail)
    // Optionally log the error for debugging
  }

  next();
};
