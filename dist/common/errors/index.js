"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerError = exports.reauthRequired = exports.rateLimited = exports.conflict = exports.notFound = exports.forbidden = exports.invalidCredentials = exports.unauthenticated = exports.validationError = exports.badRequest = exports.AppError = void 0;
const STATUS_BY_CODE = {
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
class AppError extends Error {
    code;
    status;
    details;
    expose;
    constructor(code, message, details) {
        super(message);
        this.name = "AppError";
        this.code = code;
        this.status = STATUS_BY_CODE[code];
        this.details = details;
        this.expose = this.status < 500;
        Error.captureStackTrace?.(this, AppError);
    }
}
exports.AppError = AppError;
const badRequest = (m, d) => new AppError("BAD_REQUEST", m, d);
exports.badRequest = badRequest;
const validationError = (m, d) => new AppError("VALIDATION_ERROR", m, d);
exports.validationError = validationError;
const unauthenticated = (m = "Authentication required") => new AppError("UNAUTHENTICATED", m);
exports.unauthenticated = unauthenticated;
const invalidCredentials = (m = "Invalid credentials") => new AppError("INVALID_CREDENTIALS", m);
exports.invalidCredentials = invalidCredentials;
const forbidden = (m = "Not allowed") => new AppError("FORBIDDEN", m);
exports.forbidden = forbidden;
const notFound = (m = "Resource not found") => new AppError("NOT_FOUND", m);
exports.notFound = notFound;
const conflict = (m, d) => new AppError("CONFLICT", m, d);
exports.conflict = conflict;
const rateLimited = (m = "Too many requests") => new AppError("RATE_LIMITED", m);
exports.rateLimited = rateLimited;
const reauthRequired = (m = "Re-authentication required") => new AppError("REAUTH_REQUIRED", m);
exports.reauthRequired = reauthRequired;
const providerError = (m, d) => new AppError("PROVIDER_ERROR", m, d);
exports.providerError = providerError;
//# sourceMappingURL=index.js.map