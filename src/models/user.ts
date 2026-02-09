import db from '../db.js';
import type { User } from '../types/auth-types.js';

/**
 * Create a new user in the database
 * @param email - User's email address
 * @param passwordHash - Bcrypt hash of the user's password
 * @returns The created user with ID
 * @throws Error if email already exists (unique constraint violation)
 */
export const createUser = (email: string, passwordHash: string): User => {
  const stmt = db.prepare(`
    INSERT INTO users (email, password_hash)
    VALUES (?, ?)
  `);

  try {
    const result = stmt.run(email, passwordHash);

    // Fetch the created user
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as User;
    return user;
  } catch (error: any) {
    // SQLite unique constraint error code
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message?.includes('UNIQUE constraint failed')) {
      throw new Error('Email already exists');
    }
    throw error;
  }
};

/**
 * Find a user by email address
 * @param email - Email address to search for
 * @returns User if found, undefined otherwise
 */
export const findUserByEmail = (email: string): User | undefined => {
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  return stmt.get(email) as User | undefined;
};

/**
 * Find a user by ID
 * @param id - User ID to search for
 * @returns User if found, undefined otherwise
 */
export const findUserById = (id: number): User | undefined => {
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  return stmt.get(id) as User | undefined;
};
