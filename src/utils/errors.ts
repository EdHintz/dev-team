/**
 * Custom error class that includes HTTP status code for proper error mapping
 * Used throughout the application for consistent error handling
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Set the prototype explicitly to ensure instanceof works correctly
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * Factory functions for common HTTP errors
 */
export const createBadRequestError = (message: string): AppError => {
  return new AppError(message, 400);
};

export const createUnauthorizedError = (message: string): AppError => {
  return new AppError(message, 401);
};

export const createConflictError = (message: string): AppError => {
  return new AppError(message, 409);
};

export const createNotFoundError = (message: string): AppError => {
  return new AppError(message, 404);
};
