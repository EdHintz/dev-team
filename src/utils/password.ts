import bcrypt from 'bcrypt';

/**
 * Get the number of bcrypt rounds from environment or use default
 * Minimum 10 rounds enforced for security
 */
const getBcryptRounds = (): number => {
  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
  return Math.max(rounds, 10);
};

/**
 * Hash a plain text password using bcrypt
 * @param plain - The plain text password to hash
 * @returns A promise that resolves to the bcrypt hash
 */
export const hashPassword = async (plain: string): Promise<string> => {
  const rounds = getBcryptRounds();
  return bcrypt.hash(plain, rounds);
};

/**
 * Verify a plain text password against a bcrypt hash
 * @param plain - The plain text password to verify
 * @param hash - The bcrypt hash to compare against
 * @returns A promise that resolves to true if password matches, false otherwise
 */
export const verifyPassword = async (plain: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(plain, hash);
};
