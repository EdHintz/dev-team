import { hashPassword, verifyPassword } from '../utils/password.js';
import { generateToken } from '../utils/jwt.js';
import { createUser, findUserByEmail, findUserById } from '../models/user.js';
import { createBadRequestError, createUnauthorizedError, createConflictError } from '../utils/errors.js';
import type { AuthResponse } from '../types/auth-types.js';

/**
 * Validate email format using a basic regex
 * @param email - Email address to validate
 * @returns true if email format is valid
 */
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Register a new user
 * @param email - User's email address
 * @param password - User's plain text password
 * @returns Authentication response with token and user data
 * @throws AppError 400 if email format is invalid or password is too short
 * @throws AppError 409 if email already exists
 */
export const register = async (email: string, password: string): Promise<AuthResponse> => {
  // Validate email format
  if (!isValidEmail(email)) {
    throw createBadRequestError('Invalid email format');
  }

  // Validate password length (minimum 8 characters)
  if (password.length < 8) {
    throw createBadRequestError('Password must be at least 8 characters long');
  }

  // Hash the password
  const passwordHash = await hashPassword(password);

  // Create user in database
  try {
    const user = createUser(email, passwordHash);

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email
    });

    // Return response without password_hash
    return {
      token,
      user: {
        id: user.id,
        email: user.email
      }
    };
  } catch (error: any) {
    // Check if error is due to duplicate email
    if (error.message === 'Email already exists') {
      throw createConflictError('Email already exists');
    }
    // Re-throw other errors
    throw error;
  }
};

/**
 * Authenticate a user with email and password
 * @param email - User's email address
 * @param password - User's plain text password
 * @returns Authentication response with token and user data
 * @throws AppError 401 if credentials are invalid (generic message to avoid revealing whether email or password was wrong)
 */
export const login = async (email: string, password: string): Promise<AuthResponse> => {
  // Find user by email
  const user = findUserByEmail(email);

  // If user not found, throw generic error (don't reveal that email doesn't exist)
  if (!user) {
    throw createUnauthorizedError('Invalid credentials');
  }

  // Verify password
  const isPasswordValid = await verifyPassword(password, user.password_hash);

  // If password is invalid, throw generic error (don't reveal that password was wrong)
  if (!isPasswordValid) {
    throw createUnauthorizedError('Invalid credentials');
  }

  // Generate JWT token
  const token = generateToken({
    userId: user.id,
    email: user.email
  });

  // Return response without password_hash
  return {
    token,
    user: {
      id: user.id,
      email: user.email
    }
  };
};

/**
 * Get user data by user ID
 * @param userId - User ID to retrieve
 * @returns User data without password_hash
 * @throws AppError 401 if user not found
 */
export const getCurrentUser = (userId: number): { id: number; email: string; created_at: string } => {
  const user = findUserById(userId);

  if (!user) {
    throw createUnauthorizedError('User not found');
  }

  // Return user without password_hash
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at
  };
};
