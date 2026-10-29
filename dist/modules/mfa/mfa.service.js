"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mfaService = void 0;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../../db/prisma");
const crypto_1 = require("../../common/utils/crypto");
const logger_1 = require("../../common/logger");
const audit_service_1 = require("../audit/audit.service");
const errors_1 = require("../../common/errors");
const totp_1 = require("./totp");
const log = (0, logger_1.childLogger)("mfa");
const RECOVERY_CODE_COUNT = 8;
function generateRecoveryCodes() {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => (0, node_crypto_1.randomBytes)(4).toString("hex"));
}
exports.mfaService = {
    async generateSetup(userId, ip) {
        const user = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw (0, errors_1.notFound)("User not found");
        if (user.mfaEnabled)
            throw (0, errors_1.conflict)("MFA is already enabled for this user");
        const secret = (0, totp_1.generateTotpSecret)();
        const recoveryCodes = generateRecoveryCodes();
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: {
                mfaSecret: (0, crypto_1.encryptField)(secret, "mfa_secret"),
                mfaRecoveryCodes: (0, crypto_1.encryptField)(JSON.stringify(recoveryCodes), "mfa_secret"),
            },
        });
        await (0, audit_service_1.audit)({
            actorUserId: userId,
            action: "mfa.setup_initiated",
            resourceType: "user",
            resourceId: userId,
            ip,
            metadata: {},
        });
        log.info({ userId }, "MFA setup initiated");
        return {
            secret,
            uri: (0, totp_1.buildTotpUri)(secret, user.publicId || user.id, "Sampark"),
            recoveryCodes,
        };
    },
    async confirmSetup(userId, token, ip) {
        const user = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw (0, errors_1.notFound)("User not found");
        if (!user.mfaSecret)
            throw (0, errors_1.badRequest)("No MFA setup in progress");
        if (user.mfaEnabled)
            throw (0, errors_1.conflict)("MFA is already enabled");
        const secret = (0, crypto_1.decryptField)(user.mfaSecret, "mfa_secret");
        if (!(0, totp_1.verifyTOTP)(token, secret, 1)) {
            await (0, audit_service_1.audit)({
                actorUserId: userId,
                action: "mfa.setup_confirm_failed",
                resourceType: "user",
                resourceId: userId,
                ip,
                metadata: { reason: "invalid_token" },
            });
            throw (0, errors_1.badRequest)("Invalid MFA code");
        }
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { mfaEnabled: true },
        });
        await (0, audit_service_1.audit)({
            actorUserId: userId,
            action: "mfa.enabled",
            resourceType: "user",
            resourceId: userId,
            ip,
            metadata: {},
        });
        log.info({ userId }, "MFA enabled");
        return { enabled: true };
    },
    async verifyToken(userId, token, ip) {
        const user = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.mfaEnabled || !user.mfaSecret)
            return false;
        const secret = (0, crypto_1.decryptField)(user.mfaSecret, "mfa_secret");
        const totpOk = (0, totp_1.verifyTOTP)(token, secret, 1);
        if (totpOk)
            return true;
        // Try recovery codes (single use).
        if (user.mfaRecoveryCodes) {
            try {
                const codes = JSON.parse((0, crypto_1.decryptField)(user.mfaRecoveryCodes, "mfa_secret"));
                const matched = codes.find((c) => (0, crypto_1.safeEqual)(c, token));
                if (matched) {
                    const remaining = codes.filter((c) => c !== matched);
                    await prisma_1.prisma.user.update({
                        where: { id: userId },
                        data: {
                            mfaRecoveryCodes: remaining.length
                                ? (0, crypto_1.encryptField)(JSON.stringify(remaining), "mfa_secret")
                                : null,
                        },
                    });
                    await (0, audit_service_1.audit)({
                        actorUserId: userId,
                        action: "mfa.recovery_code_used",
                        resourceType: "user",
                        resourceId: userId,
                        ip,
                        metadata: {},
                    });
                    return true;
                }
            }
            catch {
                // ignore malformed recovery codes
            }
        }
        await (0, audit_service_1.audit)({
            actorUserId: userId,
            action: "mfa.verify_failed",
            resourceType: "user",
            resourceId: userId,
            ip,
            metadata: { reason: "invalid_token" },
        });
        return false;
    },
    async isEnabled(userId) {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: { mfaEnabled: true },
        });
        return !!user?.mfaEnabled;
    },
    async disable(userId, actorUserId, ip) {
        const user = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw (0, errors_1.notFound)("User not found");
        if (userId !== actorUserId) {
            // Only admins may disable another user's MFA.
            const actor = await prisma_1.prisma.user.findUnique({ where: { id: actorUserId } });
            if (!actor || !["ADMIN", "SUPER_ADMIN"].includes(actor.role)) {
                throw (0, errors_1.forbidden)("Cannot disable another user's MFA");
            }
        }
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null },
        });
        await (0, audit_service_1.audit)({
            actorUserId: actorUserId,
            action: "mfa.disabled",
            resourceType: "user",
            resourceId: userId,
            ip,
            metadata: {},
        });
        log.info({ userId, actorUserId }, "MFA disabled");
        return { disabled: true };
    },
};
//# sourceMappingURL=mfa.service.js.map