import { prisma } from "../../db/prisma";
import { encryptField, lookupHmac, normalizeEmail, normalizePhone, randomToken } from "../../common/utils/crypto";
import { env } from "../../config";

const publicId = (): string => `usr_${randomToken(9)}`;

export const authRepository = {
  findByPhoneLookup(phone: string) {
    return prisma.user.findUnique({ where: { phoneLookupHmac: lookupHmac(normalizePhone(phone), "phone") } });
  },

  findByEmailLookup(email: string) {
    return prisma.user.findUnique({ where: { emailLookupHmac: lookupHmac(normalizeEmail(email), "email") } });
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  createFromPhone(phone: string, name?: string) {
    const normalized = normalizePhone(phone);
    return prisma.user.create({
      data: {
        publicId: publicId(),
        phoneEncrypted: encryptField(normalized, "phone"),
        phoneLookupHmac: lookupHmac(normalized, "phone"),
        nameEncrypted: name ? encryptField(name, "name") : null,
        status: "ACTIVE",
        lastLoginAt: new Date(),
      },
    });
  },

  attachEmail(userId: string, email: string) {
    const normalized = normalizeEmail(email);
    return prisma.user.update({
      where: { id: userId },
      data: { emailEncrypted: encryptField(normalized, "email"), emailLookupHmac: lookupHmac(normalized, "email") },
    });
  },

  touchLogin(userId: string) {
    return prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  },

  createRefreshToken(input: { userId: string; jti: string; userAgent?: string; ipHash?: string }) {
    return prisma.refreshToken.create({
      data: {
        userId: input.userId,
        jti: input.jti,
        userAgent: input.userAgent?.slice(0, 256),
        ipHash: input.ipHash,
        expiresAt: new Date(Date.now() + refreshTtlMs()),
      },
    });
  },

  findRefreshToken(jti: string) {
    return prisma.refreshToken.findUnique({ where: { jti } });
  },

  revokeRefreshToken(jti: string) {
    return prisma.refreshToken.updateMany({ where: { jti, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  revokeAllRefreshTokens(userId: string) {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
};

const refreshTtlMs = (): number => {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_REFRESH_TTL);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return value * multiplier;
};
