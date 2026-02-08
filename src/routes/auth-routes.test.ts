import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server.js';
import { resetDatabase } from '../db.js';

// Clear database before each test to ensure clean state
beforeEach(() => {
  resetDatabase();
});

describe('POST /api/auth/register', () => {
  it('should create user and return JWT in cookie and body', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('token');
    expect(response.body).toHaveProperty('user');
    expect(response.body.user).toHaveProperty('id');
    expect(response.body.user.email).toBe('test@example.com');

    // Check cookie is set
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/token=/);
    expect(cookies[0]).toMatch(/HttpOnly/);
    expect(cookies[0]).toMatch(/SameSite=Strict/);
  });

  it('should return 400 for invalid email format', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'invalid-email',
        password: 'password123'
      });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  it('should return 400 for password less than 8 characters', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'short'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/8 characters/i);
  });

  it('should return 409 for duplicate email', async () => {
    // Register first user
    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });

    // Try to register with same email
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password456'
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/already exists/i);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    // Register a test user
    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });
  });

  it('should return JWT for valid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('token');
    expect(response.body).toHaveProperty('user');
    expect(response.body.user.email).toBe('test@example.com');

    // Check cookie is set
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/token=/);
    expect(cookies[0]).toMatch(/HttpOnly/);
  });

  it('should return 401 for invalid email', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nonexistent@example.com',
        password: 'password123'
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/invalid credentials/i);
  });

  it('should return 401 for invalid password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'wrongpassword'
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/invalid credentials/i);
  });

  it('should be rate-limited to 5 requests per minute per IP', async () => {
    // Make 5 requests (should all succeed or fail based on credentials)
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword'
        });
    }

    // 6th request should be rate limited
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'wrongpassword'
      });

    expect(response.status).toBe(429);
    expect(response.body.error).toMatch(/too many/i);
  }, 10000); // Increase timeout for this test
});

describe('POST /api/auth/logout', () => {
  it('should clear the token cookie', async () => {
    const response = await request(app)
      .post('/api/auth/logout');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toMatch(/logged out/i);

    // Check that cookie is cleared
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/token=/);
    // The cookie should have an expiry in the past or Max-Age=0
  });
});

describe('GET /api/auth/me', () => {
  let authToken: string;

  beforeEach(async () => {
    // Register and login to get a token
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });

    authToken = response.body.token;
  });

  it('should return user data when authenticated with cookie', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [`token=${authToken}`]);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('user');
    expect(response.body.user.email).toBe('test@example.com');
    expect(response.body.user).toHaveProperty('id');
    expect(response.body.user).toHaveProperty('created_at');
  });

  it('should return user data when authenticated with Bearer token', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('user');
    expect(response.body.user.email).toBe('test@example.com');
  });

  it('should return 401 when not authenticated', async () => {
    const response = await request(app)
      .get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toMatch(/authentication/i);
  });

  it('should return 401 for invalid token', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });
});

describe('Global error handling', () => {
  it('should map AppError to correct HTTP status codes', async () => {
    // Test 400 - Bad Request
    const badRequest = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'short' // Too short
      });
    expect(badRequest.status).toBe(400);

    // Test 401 - Unauthorized (use /me endpoint to avoid rate limiting issues)
    const unauthorized = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token');
    expect(unauthorized.status).toBe(401);

    // Test 404 - Not Found
    const notFound = await request(app)
      .get('/api/nonexistent');
    expect(notFound.status).toBe(404);
  });
});

describe('HTTP-only cookie configuration', () => {
  it('should set cookie with sameSite strict', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });

    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/SameSite=Strict/i);
  });

  it('should set httpOnly flag', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });

    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/HttpOnly/i);
  });

  it('should set maxAge to 24 hours', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });

    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    // 24 hours = 86400000 milliseconds
    expect(cookies[0]).toMatch(/Max-Age=86400/i);
  });
});

describe('Server export for testing', () => {
  it('should export Express app separately from listen()', () => {
    // If we can import and use the app for testing, it's exported correctly
    expect(app).toBeDefined();
    expect(typeof app).toBe('function'); // Express app is a function
  });
});
