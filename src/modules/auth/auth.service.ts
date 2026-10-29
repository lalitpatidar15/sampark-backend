import type { User } from "@prisma/client";
import { AppError, unauthenticated } from "../../common/errors";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../common/guards/tokens";
import { decryptField, normalizePhone, randomToken, sha256 } from "../../common/utils/crypto";
import { childLogger } from "../../common/logger";
import { authRepository } from "./auth.repository";
import { requestOtp, verifyOtp, type OtpPurpose } from "./otp.service";
import { permissionsForRole } from "../../common/guards/permissions";

const log = childLogger("auth.service");

export interface SafeUser {
  publicId: string;
  role: string;
  status: string;
  name: string | null;
  phone: string;
  email: string | null;
  enabledChannels: string[];
  allowLocationShare: boolean;
  allowVideoCalls: boolean;
  createdAt: Date;
}

/**
 * The owner-facing projection. Phone/email are decrypted only for the
 * authenticated owner themselves and are never placed on a public scanner
 * response (spec 8.1, 32.2).
 */
export const toSafeUser = (user: User): SafeUser => ({
  publicId: user.publicId,
  role: user.role,
  status: user.status,
  name: user.nameEncrypted ? decryptField(user.nameEncrypted, "name") : null,
  phone: decryptField(user.phoneEncrypted, "phone"),
  email: user.emailEncrypted ? decryptField(user.emailEncrypted, "email") : null,
  enabledChannels: user.enabledChannels,
  allowLocationShare: user.allowLocationShare,
  allowVideoCalls: user.allowVideoCalls,
  createdAt: user.createdAt,
});

export const authService = {
  requestOtp(phone: string, purpose: OtpPurpose) {
    return requestOtp({ phone, purpose });
  },

  verifyPhoneOtp(phone: string, code: string) {
    return verifyOtp({ phone, code, purpose: "LOGIN" });
  },

  /**
   * OTP-only login. Accounts are created on first verified login, which keeps
   * the flow app-install-free for a visitor and phone-only for an owner.
   */
  async login(input: { phone: string; code: string; userAgent?: string; ip?: string }): Promise<{
    user: SafeUser;
    accessToken: string;
    refreshToken: string;
    isNewUser: boolean;
    permissions: string[];
  }> {
    await verifyOtp({ phone: input.phone, code: input.code, purpose: "LOGIN" });

    const phone = normalizePhone(input.phone);
    let user = await authRepository.findByPhoneLookup(phone);
    let isNewUser = false;

    if (!user) {
      user = await authRepository.createFromPhone(phone);
      isNewUser = true;
      log.info({ userId: user.id }, "new owner account provisioned");
    }

    if (user.status === "SUSPENDED") {
      throw new AppError("FORBIDDEN", "This account is suspended. Contact support.");
    }
    if (user.status === "DELETED" || user.deletedAt) {
      throw unauthenticated("This account has been deleted");
    }

    await authRepository.touchLogin(user.id);

    const jti = randomToken(16);
    await authRepository.createRefreshToken({
      userId: user.id,
      jti,
      userAgent: input.userAgent,
      ipHash: input.ip ? sha256(input.ip) : undefined,
    });

    return {
      user: toSafeUser(user),
      accessToken: signAccessToken(user.id, user.role),
      refreshToken: signRefreshToken(user.id, jti),
      isNewUser,
      // Returned so a client can hide what the role cannot do. The API still
      // enforces every permission server-side; this is presentation only.
      permissions: permissionsForRole(user.role),
    };
  },

  /**
   * Rotating refresh. The presented token is revoked and a new one issued, so a
   * stolen refresh token is usable at most once before the rotation window.
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; user: SafeUser }> {
    const payload = verifyRefreshToken(refreshToken);
    const stored = await authRepository.findRefreshToken(payload.jti);

    if (!stored || stored.revokedAt || stored.expiresAt.getTime() <= Date.now()) {
      throw unauthenticated("Session expired. Please sign in again.");
    }
    if (stored.userId !== payload.sub) {
      throw unauthenticated("Invalid session");
    }

    const user = await authRepository.findById(payload.sub);
    if (!user || user.status !== "ACTIVE" || user.deletedAt) {
      throw unauthenticated("Account is not active");
    }

    await authRepository.revokeRefreshToken(payload.jti);

    const jti = randomToken(16);
    await authRepository.createRefreshToken({ userId: user.id, jti });

    return {
      accessToken: signAccessToken(user.id, user.role),
      refreshToken: signRefreshToken(user.id, jti),
      user: toSafeUser(user),
    };
  },

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    try {
      const payload = verifyRefreshToken(refreshToken);
      await authRepository.revokeRefreshToken(payload.jti);
    } catch {
      /* logging out with an already-invalid token is not an error */
    }
  },

  async logoutAll(userId: string): Promise<void> {
    await authRepository.revokeAllRefreshTokens(userId);
  },

  async me(userId: string): Promise<SafeUser & { permissions: string[] }> {
    const user = await authRepository.findById(userId);
    if (!user) throw unauthenticated("Account not found");
    return { ...toSafeUser(user), permissions: permissionsForRole(user.role) };
  },

  /**
   * Issues a short-lived token proving a fresh OTP check. Sensitive operations
   * require it via the x-reauth-token header (spec 30).
   */
  async reauthenticate(userId: string, phone: string, code: string): Promise<{ reauthToken: string }> {
    const user = await authRepository.findById(userId);
    if (!user) throw unauthenticated("Account not found");

    // Re-auth must be against the phone already on the account, not a caller-supplied number.
    const storedPhone = decryptField(user.phoneEncrypted, "phone");
    if (normalizePhone(phone) !== storedPhone) {
      throw new AppError("FORBIDDEN", "Re-authentication must use the phone number on the account");
    }

    await verifyOtp({ phone: storedPhone, code, purpose: "REAUTH" });
    return { reauthToken: signAccessToken(user.id, user.role) };
  },
};
