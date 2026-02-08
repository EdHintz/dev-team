import Database from 'better-sqlite3';
import { dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

/**
 * Get database file path from environment or use default
 */
const getDbPath = (): string => {
  return process.env.DB_PATH || './data/dev.db';
};

/**
 * Ensure the database directory exists
 */
const ensureDbDirectory = (dbPath: string): void => {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
};

/**
 * Initialize the SQLite database
 */
const initDb = (): Database.Database => {
  const dbPath = getDbPath();
  ensureDbDirectory(dbPath);

  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  return db;
};

/**
 * Create the database schema
 */
const createSchema = (db: Database.Database): void => {
  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create unique index on email for fast lookups
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);
};

/**
 * Export type for the database instance
 */
export type DbInstance = Database.Database;

// Initialize database and create schema
const db: DbInstance = initDb();
createSchema(db);

/**
 * Export the database instance
 */
export default db;
