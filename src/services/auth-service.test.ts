import { describe, it, expect, beforeEach } from 'vitest';
import { register, login, getCurrentUser } from './auth-service';
import { resetDatabase } from '../db';
import { findUserByEmail } from '../models/user';
import { AppError } from '../utils/errors';

describe('Auth Service', () => {
  beforeEach(() => {
    // Reset database before each test
    resetDatabase();
  });

  describe('register', () => {
    it('should create user and return token', async () => {
      const email = 'newuser@example.com';
      const password = 'validPassword123';

      const response = await register(email, password);

      expect(response).toBeDefined();
      expect(response.token).toBeDefined();
      expect(response.user).toBeDefined();
      expect(response.user.id).toBeDefined();
      expect(response.user.email).toBe(email);
      // Password hash should not be returned
      expect(response.user).not.toHaveProperty('password_hash');
    });

    it('should reject password shorter than 8 characters', async () => {
      const email = 'user@example.com';
      const shortPassword = 'short';

      try {
        await register(email, shortPassword);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).statusCode).toBe(400);
        expect(error).toHaveProperty('message', 'Password must be at least 8 characters long');
      }
    });

    it('should reject duplicate email', async () => {
      const email = 'duplicate@example.com';
      const password = 'validPassword123';

      // First registration should succeed
      await register(email, password);

      // Second registration with same email should fail
      try {
        await register(email, password);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).statusCode).toBe(409);
        expect(error).toHaveProperty('message', 'Email already exists');
      }
    });

    it('should reject invalid email format', async () => {
      const invalidEmail = 'notanemail';
      const password = 'validPassword123';

      try {
        await register(invalidEmail, password);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).statusCode).toBe(400);
        expect(error).toHaveProperty('message', 'Invalid email format');
      }
    });

    it('should hash the password before storing', async () => {
      const email = 'user@example.com';
      const password = 'validPassword123';

      await register(email, password);

      // Verify the password was actually hashed by checking it's a bcrypt hash
      const user = findUserByEmail(email);
      expect(user?.password_hash).toMatch(/^\$2[aby]\$/);
      expect(user?.password_hash).toHaveLength(60);
    });
  });

  describe('login', () => {
    const testEmail = 'existing@example.com';
    const testPassword = 'validPassword123';

    beforeEach(async () => {
      // Create a test user before each login test
      await register(testEmail, testPassword);
    });

    it('should login with valid credentials', async () => {
      const response = await login(testEmail, testPassword);

      expect(response).toBeDefined();
      expect(response.token).toBeDefined();
      expect(response.user).toBeDefined();
      expect(response.user.email).toBe(testEmail);
      expect(response.user).not.toHaveProperty('password_hash');
    });

    it('should reject login with wrong password', async () => {
      const wrongPassword = 'wrongPassword456';

      try {
        await login(testEmail, wrongPassword);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).statusCode).toBe(401);
        expect(error).toHaveProperty('message', 'Invalid credentials');
      }
    });

    it('should reject login with non-existent email', async () => {
      const nonExistentEmail = 'nonexistent@example.com';

      try {
        await login(nonExistentEmail, testPassword);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).statusCode).toBe(401);
        expect(error).toHaveProperty('message', 'Invalid credentials');
      }
    });

    it('should return same email from login as was registered', async () => {
      const response = await login(testEmail, testPassword);

      expect(response.user.email).toBe(testEmail);
    });
  });

  describe('getCurrentUser', () => {
    it('should return user without password hash', async () => {
      const email = 'user@example.com';
      const password = 'validPassword123';

      const registerResponse = await register(email, password);
      const userId = registerResponse.user.id;

      const user = getCurrentUser(userId);

      expect(user).toBeDefined();
      expect(user.id).toBe(userId);
      expect(user.email).toBe(email);
      expect(user.created_at).toBeDefined();
      expect(user).not.toHaveProperty('password_hash');
    });

    it('should throw error for non-existent user', () => {
      const nonExistentId = 99999;

      try {
        getCurrentUser(nonExistentId);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).statusCode).toBe(401);
        expect(error).toHaveProperty('message', 'User not found');
      }
    });

    it('should return correct created_at timestamp', async () => {
      const email = 'user@example.com';
      const password = 'validPassword123';

      const registerResponse = await register(email, password);
      const userId = registerResponse.user.id;

      const user = getCurrentUser(userId);

      // created_at should be a valid timestamp string
      expect(typeof user.created_at).toBe('string');
      expect(user.created_at.length).toBeGreaterThan(0);
    });
  });
});
