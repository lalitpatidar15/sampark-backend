import { randomBytes } from "node:crypto";
import { prisma } from "../../db/prisma";
import { encryptField, decryptField, safeEqual } from "../../common/utils/crypto";
import { childLogger } from "../../common/logger";
import { audit } from "../audit/audit.service";
import { notFound, badRequest, conflict, forbidden } from "../../common/errors";
import {
  verifyTOTP,
  generateTotpSecret,
  buildTotpUri,
} from "./totp";

const log = childLogger("mfa");

const RECOVERY_CODE_COUNT = 8;

function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    randomBytes(4).toString("hex"),
  );
}

export const mfaService = {
  async generateSetup(userId: string, ip?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    if (user.mfaEnabled) throw conflict("MFA is already enabled for this user");

    const secret = generateTotpSecret();
    const recoveryCodes = generateRecoveryCodes();

    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaSecret: encryptField(secret, "mfa_secret"),
        mfaRecoveryCodes: encryptField(JSON.stringify(recoveryCodes), "mfa_secret"),
      },
    });

    await audit({
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
      uri: buildTotpUri(secret, user.publicId || user.id, "Sampark"),
      recoveryCodes,
    };
  },

  async confirmSetup(userId: string, token: string, ip?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    if (!user.mfaSecret) throw badRequest("No MFA setup in progress");
    if (user.mfaEnabled) throw conflict("MFA is already enabled");

    const secret = decryptField(user.mfaSecret, "mfa_secret");
    if (!verifyTOTP(token, secret, 1)) {
      await audit({
        actorUserId: userId,
        action: "mfa.setup_confirm_failed",
        resourceType: "user",
        resourceId: userId,
        ip,
        metadata: { reason: "invalid_token" },
      });
      throw badRequest("Invalid MFA code");
    }

    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    await audit({
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

  async verifyToken(userId: string, token: string, ip?: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabled || !user.mfaSecret) return false;

    const secret = decryptField(user.mfaSecret, "mfa_secret");
    const totpOk = verifyTOTP(token, secret, 1);
    if (totpOk) return true;

    // Try recovery codes (single use).
    if (user.mfaRecoveryCodes) {
      try {
        const codes: string[] = JSON.parse(decryptField(user.mfaRecoveryCodes, "mfa_secret"));
        const matched = codes.find((c) => safeEqual(c, token));
        if (matched) {
          const remaining = codes.filter((c) => c !== matched);
          await prisma.user.update({
            where: { id: userId },
            data: {
              mfaRecoveryCodes: remaining.length
                ? encryptField(JSON.stringify(remaining), "mfa_secret")
                : null,
            },
          });
          await audit({
            actorUserId: userId,
            action: "mfa.recovery_code_used",
            resourceType: "user",
            resourceId: userId,
            ip,
            metadata: {},
          });
          return true;
        }
      } catch {
        // ignore malformed recovery codes
      }
    }

    await audit({
      actorUserId: userId,
      action: "mfa.verify_failed",
      resourceType: "user",
      resourceId: userId,
      ip,
      metadata: { reason: "invalid_token" },
    });
    return false;
  },

  async isEnabled(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabled: true },
    });
    return !!user?.mfaEnabled;
  },

  async disable(userId: string, actorUserId: string, ip?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    if (userId !== actorUserId) {
      // Only admins may disable another user's MFA.
      const actor = await prisma.user.findUnique({ where: { id: actorUserId } });
      if (!actor || !["ADMIN", "SUPER_ADMIN"].includes(actor.role)) {
        throw forbidden("Cannot disable another user's MFA");
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null },
    });

    await audit({
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
