# Feature: User Authentication

## Overview
Add email/password authentication to the web application, including registration, login, logout, and session management.

## Requirements

### Functional
1. Users can register with email and password
2. Users can log in with valid credentials
3. Users can log out, invalidating their session
4. Passwords are hashed before storage (bcrypt, minimum 10 rounds)
5. Sessions use HTTP-only cookies with JWT tokens
6. Protected routes return 401 for unauthenticated requests

### Non-Functional
- Login response time under 500ms
- Passwords must be at least 8 characters
- JWT tokens expire after 24 hours
- Rate limit login attempts to 5 per minute per IP

## Constraints
- Must work with the existing Express/Fastify server setup
- Use the project's existing database (or add SQLite if none exists)
- No third-party auth providers (OAuth comes later)

## Out of Scope
- Password reset / forgot password flow
- Email verification
- OAuth / social login
- Two-factor authentication
- User profile management

## Acceptance Criteria
- [ ] POST /api/auth/register creates a new user and returns a JWT
- [ ] POST /api/auth/login returns a JWT for valid credentials
- [ ] POST /api/auth/login returns 401 for invalid credentials
- [ ] POST /api/auth/logout invalidates the session
- [ ] GET /api/auth/me returns the current user when authenticated
- [ ] GET /api/auth/me returns 401 when not authenticated
- [ ] Passwords are stored as bcrypt hashes (never plaintext)
- [ ] All existing tests continue to pass
- [ ] New auth endpoints have test coverage
