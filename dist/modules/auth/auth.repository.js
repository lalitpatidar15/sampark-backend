"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRepository = void 0;
const prisma_1 = require("../../db/prisma");
const crypto_1 = require("../../common/utils/crypto");
const config_1 = require("../../config");
const publicId = () => `usr_${(0, crypto_1.randomToken)(9)}`;
exports.authRepository = {
    findByPhoneLookup(phone) {
        return prisma_1.prisma.user.findUnique({ where: { phoneLookupHmac: (0, crypto_1.lookupHmac)((0, crypto_1.normalizePhone)(phone), "phone") } });
    },
    findByEmailLookup(email) {
        return prisma_1.prisma.user.findUnique({ where: { emailLookupHmac: (0, crypto_1.lookupHmac)((0, crypto_1.normalizeEmail)(email), "email") } });
    },
    findById(id) {
        return prisma_1.prisma.user.findUnique({ where: { id } });
    },
    createFromPhone(phone, name) {
        const normalized = (0, crypto_1.normalizePhone)(phone);
        return prisma_1.prisma.user.create({
            data: {
                publicId: publicId(),
                phoneEncrypted: (0, crypto_1.encryptField)(normalized, "phone"),
                phoneLookupHmac: (0, crypto_1.lookupHmac)(normalized, "phone"),
                nameEncrypted: name ? (0, crypto_1.encryptField)(name, "name") : null,
                status: "ACTIVE",
                lastLoginAt: new Date(),
            },
        });
    },
    attachEmail(userId, email) {
        const normalized = (0, crypto_1.normalizeEmail)(email);
        return prisma_1.prisma.user.update({
            where: { id: userId },
            data: { emailEncrypted: (0, crypto_1.encryptField)(normalized, "email"), emailLookupHmac: (0, crypto_1.lookupHmac)(normalized, "email") },
        });
    },
    touchLogin(userId) {
        return prisma_1.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    },
    createRefreshToken(input) {
        return prisma_1.prisma.refreshToken.create({
            data: {
                userId: input.userId,
                jti: input.jti,
                userAgent: input.userAgent?.slice(0, 256),
                ipHash: input.ipHash,
                expiresAt: new Date(Date.now() + refreshTtlMs()),
            },
        });
    },
    findRefreshToken(jti) {
        return prisma_1.prisma.refreshToken.findUnique({ where: { jti } });
    },
    revokeRefreshToken(jti) {
        return prisma_1.prisma.refreshToken.updateMany({ where: { jti, revokedAt: null }, data: { revokedAt: new Date() } });
    },
    revokeAllRefreshTokens(userId) {
        return prisma_1.prisma.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    },
};
const refreshTtlMs = () => {
    const match = /^(\d+)([smhd])$/.exec(config_1.env.JWT_REFRESH_TTL);
    if (!match)
        return 30 * 24 * 60 * 60 * 1000;
    const value = Number(match[1]);
    const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
    return value * multiplier;
};
//# sourceMappingURL=auth.repository.js.map