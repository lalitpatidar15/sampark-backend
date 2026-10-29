"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = exports.toSafeUser = void 0;
const errors_1 = require("../../common/errors");
const tokens_1 = require("../../common/guards/tokens");
const crypto_1 = require("../../common/utils/crypto");
const logger_1 = require("../../common/logger");
const auth_repository_1 = require("./auth.repository");
const otp_service_1 = require("./otp.service");
const permissions_1 = require("../../common/guards/permissions");
const log = (0, logger_1.childLogger)("auth.service");
/**
 * The owner-facing projection. Phone/email are decrypted only for the
 * authenticated owner themselves and are never placed on a public scanner
 * response (spec 8.1, 32.2).
 */
const toSafeUser = (user) => ({
    publicId: user.publicId,
    role: user.role,
    status: user.status,
    name: user.nameEncrypted ? (0, crypto_1.decryptField)(user.nameEncrypted, "name") : null,
    phone: (0, crypto_1.decryptField)(user.phoneEncrypted, "phone"),
    email: user.emailEncrypted ? (0, crypto_1.decryptField)(user.emailEncrypted, "email") : null,
    enabledChannels: user.enabledChannels,
    allowLocationShare: user.allowLocationShare,
    allowVideoCalls: user.allowVideoCalls,
    createdAt: user.createdAt,
});
exports.toSafeUser = toSafeUser;
exports.authService = {
    requestOtp(phone, purpose) {
        return (0, otp_service_1.requestOtp)({ phone, purpose });
    },
    verifyPhoneOtp(phone, code) {
        return (0, otp_service_1.verifyOtp)({ phone, code, purpose: "LOGIN" });
    },
    /**
     * OTP-only login. Accounts are created on first verified login, which keeps
     * the flow app-install-free for a visitor and phone-only for an owner.
     */
    async login(input) {
        await (0, otp_service_1.verifyOtp)({ phone: input.phone, code: input.code, purpose: "LOGIN" });
        const phone = (0, crypto_1.normalizePhone)(input.phone);
        let user = await auth_repository_1.authRepository.findByPhoneLookup(phone);
        let isNewUser = false;
        if (!user) {
            user = await auth_repository_1.authRepository.createFromPhone(phone);
            isNewUser = true;
            log.info({ userId: user.id }, "new owner account provisioned");
        }
        if (user.status === "SUSPENDED") {
            throw new errors_1.AppError("FORBIDDEN", "This account is suspended. Contact support.");
        }
        if (user.status === "DELETED" || user.deletedAt) {
            throw (0, errors_1.unauthenticated)("This account has been deleted");
        }
        await auth_repository_1.authRepository.touchLogin(user.id);
        const jti = (0, crypto_1.randomToken)(16);
        await auth_repository_1.authRepository.createRefreshToken({
            userId: user.id,
            jti,
            userAgent: input.userAgent,
            ipHash: input.ip ? (0, crypto_1.sha256)(input.ip) : undefined,
        });
        return {
            user: (0, exports.toSafeUser)(user),
            accessToken: (0, tokens_1.signAccessToken)(user.id, user.role),
            refreshToken: (0, tokens_1.signRefreshToken)(user.id, jti),
            isNewUser,
            // Returned so a client can hide what the role cannot do. The API still
            // enforces every permission server-side; this is presentation only.
            permissions: (0, permissions_1.permissionsForRole)(user.role),
        };
    },
    /**
     * Rotating refresh. The presented token is revoked and a new one issued, so a
     * stolen refresh token is usable at most once before the rotation window.
     */
    async refresh(refreshToken) {
        const payload = (0, tokens_1.verifyRefreshToken)(refreshToken);
        const stored = await auth_repository_1.authRepository.findRefreshToken(payload.jti);
        if (!stored || stored.revokedAt || stored.expiresAt.getTime() <= Date.now()) {
            throw (0, errors_1.unauthenticated)("Session expired. Please sign in again.");
        }
        if (stored.userId !== payload.sub) {
            throw (0, errors_1.unauthenticated)("Invalid session");
        }
        const user = await auth_repository_1.authRepository.findById(payload.sub);
        if (!user || user.status !== "ACTIVE" || user.deletedAt) {
            throw (0, errors_1.unauthenticated)("Account is not active");
        }
        await auth_repository_1.authRepository.revokeRefreshToken(payload.jti);
        const jti = (0, crypto_1.randomToken)(16);
        await auth_repository_1.authRepository.createRefreshToken({ userId: user.id, jti });
        return {
            accessToken: (0, tokens_1.signAccessToken)(user.id, user.role),
            refreshToken: (0, tokens_1.signRefreshToken)(user.id, jti),
            user: (0, exports.toSafeUser)(user),
        };
    },
    async logout(refreshToken) {
        if (!refreshToken)
            return;
        try {
            const payload = (0, tokens_1.verifyRefreshToken)(refreshToken);
            await auth_repository_1.authRepository.revokeRefreshToken(payload.jti);
        }
        catch {
            /* logging out with an already-invalid token is not an error */
        }
    },
    async logoutAll(userId) {
        await auth_repository_1.authRepository.revokeAllRefreshTokens(userId);
    },
    async me(userId) {
        const user = await auth_repository_1.authRepository.findById(userId);
        if (!user)
            throw (0, errors_1.unauthenticated)("Account not found");
        return { ...(0, exports.toSafeUser)(user), permissions: (0, permissions_1.permissionsForRole)(user.role) };
    },
    /**
     * Issues a short-lived token proving a fresh OTP check. Sensitive operations
     * require it via the x-reauth-token header (spec 30).
     */
    async reauthenticate(userId, phone, code) {
        const user = await auth_repository_1.authRepository.findById(userId);
        if (!user)
            throw (0, errors_1.unauthenticated)("Account not found");
        // Re-auth must be against the phone already on the account, not a caller-supplied number.
        const storedPhone = (0, crypto_1.decryptField)(user.phoneEncrypted, "phone");
        if ((0, crypto_1.normalizePhone)(phone) !== storedPhone) {
            throw new errors_1.AppError("FORBIDDEN", "Re-authentication must use the phone number on the account");
        }
        await (0, otp_service_1.verifyOtp)({ phone: storedPhone, code, purpose: "REAUTH" });
        return { reauthToken: (0, tokens_1.signAccessToken)(user.id, user.role) };
    },
};
//# sourceMappingURL=auth.service.js.map