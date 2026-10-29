export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "REAUTH_REQUIRED"
  | "TAG_INACTIVE"
  | "CHANNEL_DISABLED"
  | "PROVIDER_ERROR"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  REAUTH_REQUIRED: 401,
  TAG_INACTIVE: 409,
  CHANNEL_DISABLED: 403,
  PROVIDER_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
    this.expose = this.status < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError("BAD_REQUEST", m, d);
export const validationError = (m: string, d?: unknown) => new AppError("VALIDATION_ERROR", m, d);
export const unauthenticated = (m = "Authentication required") => new AppError("UNAUTHENTICATED", m);
export const invalidCredentials = (m = "Invalid credentials") => new AppError("INVALID_CREDENTIALS", m);
export const forbidden = (m = "Not allowed") => new AppError("FORBIDDEN", m);
export const notFound = (m = "Resource not found") => new AppError("NOT_FOUND", m);
export const conflict = (m: string, d?: unknown) => new AppError("CONFLICT", m, d);
export const rateLimited = (m = "Too many requests") => new AppError("RATE_LIMITED", m);
export const reauthRequired = (m = "Re-authentication required") => new AppError("REAUTH_REQUIRED", m);
export const providerError = (m: string, d?: unknown) => new AppError("PROVIDER_ERROR", m, d);
