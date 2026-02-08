/**
 * User entity representing a registered user in the system
 */
export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
}

/**
 * JWT payload containing user identification
 */
export interface AuthPayload {
  userId: number;
  email: string;
}

/**
 * Registration request payload
 */
export interface RegisterRequest {
  email: string;
  password: string;
}

/**
 * Login request payload
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Authentication response returned after successful login/register
 */
export interface AuthResponse {
  token: string;
  user: {
    id: number;
    email: string;
  };
}
