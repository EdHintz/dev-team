import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import * as authService from '../services/auth-service.js';
import { requireAuth } from '../middleware/auth-middleware.js';
import type { RegisterRequest, LoginRequest } from '../types/auth-types.js';

const router = Router();

// Rate limiter for login endpoint - 5 requests per minute per IP
const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per window
  message: {
    error: 'Too many login attempts',
    message: 'Please try again later'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

/**
 * POST /api/auth/register
 * Register a new user
 * Request body: { email: string, password: string }
 * Response: { user: { id, email }, token: string }
 * Sets HTTP-only cookie with JWT token
 */
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body as RegisterRequest;

    // Validate request body
    if (!email || !password) {
      res.status(400).json({
        error: 'Validation error',
        message: 'Email and password are required'
      });
      return;
    }

    // Register user
    const result = await authService.register(email, password);

    // Set HTTP-only cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', result.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: isProduction, // Only use secure flag in production (HTTPS)
      maxAge: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
    });

    // Return user and token
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/login
 * Authenticate a user
 * Request body: { email: string, password: string }
 * Response: { user: { id, email }, token: string }
 * Sets HTTP-only cookie with JWT token
 * Rate limited to 5 requests per minute per IP
 */
router.post('/login', loginRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body as LoginRequest;

    // Validate request body
    if (!email || !password) {
      res.status(400).json({
        error: 'Validation error',
        message: 'Email and password are required'
      });
      return;
    }

    // Authenticate user
    const result = await authService.login(email, password);

    // Set HTTP-only cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', result.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: isProduction, // Only use secure flag in production (HTTPS)
      maxAge: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
    });

    // Return user and token
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/logout
 * Clear authentication token
 * Response: { message: string }
 */
router.post('/logout', (_req: Request, res: Response) => {
  // Clear the token cookie
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  });

  res.status(200).json({
    message: 'Logged out successfully'
  });
});

/**
 * GET /api/auth/me
 * Get current authenticated user
 * Requires: Valid JWT token (via cookie or Authorization header)
 * Response: { user: { id, email, created_at } }
 */
router.get('/me', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    // req.user is set by requireAuth middleware
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No user found'
      });
      return;
    }

    // Get full user data
    const user = authService.getCurrentUser(req.user.userId);

    res.status(200).json({
      user
    });
  } catch (error) {
    next(error);
  }
});

export default router;
