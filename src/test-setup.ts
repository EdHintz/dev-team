/**
 * Test setup file - runs before all tests
 * Sets up environment variables needed for testing
 */

// Set JWT_SECRET for testing
process.env.JWT_SECRET = 'test-secret-key-for-jwt-tokens';

// Use test database
process.env.DB_PATH = ':memory:';

// Set NODE_ENV to test
process.env.NODE_ENV = 'test';
