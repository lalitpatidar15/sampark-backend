"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRecentReauth = exports.requireRole = exports.requirePermission = exports.authenticate = void 0;
const prisma_1 = require("../../db/prisma");
const errors_1 = require("../errors");
const permissions_1 = require("../guards/permissions");
const tokens_1 = require("../guards/tokens");
const extractBearer = (req) => {
    const header = req.header("authorization");
    if (header?.startsWith("Bearer "))
        return header.slice(7).trim();
    return undefined;
};
/**
 * Verifies the access token and confirms the account is still usable.
 * Authorization is re-checked against the database on every request; a token
 * signed before a suspension must not keep working.
 */
const authenticate = (req, _res, next) => {
    void (async () => {
        try {
            const token = extractBearer(req);
            if (!token)
                throw (0, errors_1.unauthenticated)();
            const payload = (0, tokens_1.verifyAccessToken)(token);
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: payload.sub },
                select: { id: true, role: true, status: true, deletedAt: true },
            });
            if (!user || user.deletedAt)
                throw (0, errors_1.unauthenticated)("Account not found");
            if (user.status === "SUSPENDED")
                throw (0, errors_1.forbidden)("Account is suspended");
            if (user.status === "DELETED")
                throw (0, errors_1.unauthenticated)("Account is deleted");
            req.user = {
                id: user.id,
                role: user.role,
                perms: (0, permissions_1.permissionsForRole)(user.role),
            };
            next();
        }
        catch (error) {
            next(error);
        }
    })();
};
exports.authenticate = authenticate;
const requirePermission = (...required) => (req, _res, next) => {
    if (!req.user)
        return next((0, errors_1.unauthenticated)());
    const granted = new Set(req.user.perms);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
        return next((0, errors_1.forbidden)(`Missing permission: ${missing.join(", ")}`));
    }
    return next();
};
exports.requirePermission = requirePermission;
const requireRole = (...roles) => (req, _res, next) => {
    if (!req.user)
        return next((0, errors_1.unauthenticated)());
    if (!roles.includes(req.user.role)) {
        return next((0, errors_1.forbidden)("Insufficient role for this operation"));
    }
    return next();
};
exports.requireRole = requireRole;
/**
 * Sensitive operations (phone change, tag transfer, account deletion, data
 * export, emergency contact change, document reveal) require a fresh OTP
 * within the last few minutes.
 */
const REAUTH_WINDOW_MS = 5 * 60 * 1000;
const requireRecentReauth = (req, _res, next) => {
    const header = req.header("x-reauth-token");
    if (!header) {
        return next((0, errors_1.forbidden)("This operation requires re-authentication. Verify an OTP and resend the x-reauth-token header."));
    }
    const payload = (0, tokens_1.verifyAccessToken)(header);
    if (payload.typ !== "access")
        return next((0, errors_1.forbidden)("Invalid re-auth token"));
    if (!req.user || payload.sub !== req.user.id) {
        return next((0, errors_1.forbidden)("Re-auth token does not match the authenticated user"));
    }
    if (Date.now() - payload.iat * 1000 > REAUTH_WINDOW_MS) {
        return next((0, errors_1.forbidden)("Re-authentication has expired. Please verify your OTP again."));
    }
    return next();
};
exports.requireRecentReauth = requireRecentReauth;
//# sourceMappingURL=auth.js.map