import { prisma } from "../../db/prisma";
import { AppError, forbidden, notFound } from "../../common/errors";
import { encryptField, lookupHmac, normalizeEmail } from "../../common/utils/crypto";
import { toSafeUser } from "../auth/auth.service";
import { audit } from "../audit/audit.service";
import { authRepository } from "../auth/auth.repository";

const SENSITIVE_CHANNELS = ["PUSH"];

export const userService = {
  async getProfile(userId: string) {
    const user = await authRepository.findById(userId);
    if (!user) throw notFound("Account not found");
    return toSafeUser(user);
  },

  /**
   * Owner-controlled privacy preferences (spec 4.1, 8.1). Channels are
   * intersected with the platform's supported set so an unknown value can never
   * be persisted and later trusted by the privacy gateway.
   */
  async updatePrivacySettings(input: {
    userId: string;
    enabledChannels?: string[];
    allowLocationShare?: boolean;
    allowVideoCalls?: boolean;
    allowUnknownCallers?: boolean;
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
    ip?: string;
  }) {
    const data: Record<string, unknown> = {};

    if (input.enabledChannels) {
      const allowed = ["VOICE", "VIDEO", "SMS", "WHATSAPP", "CHAT", ...SENSITIVE_CHANNELS];
      const cleaned = input.enabledChannels.filter((c) => allowed.includes(c));
      data.enabledChannels = cleaned;
    }
    if (input.allowLocationShare !== undefined) data.allowLocationShare = input.allowLocationShare;
    if (input.allowVideoCalls !== undefined) data.allowVideoCalls = input.allowVideoCalls;
    if (input.allowUnknownCallers !== undefined) data.allowUnknownCallers = input.allowUnknownCallers;
    if (input.quietHoursStart !== undefined) data.quietHoursStart = input.quietHoursStart;
    if (input.quietHoursEnd !== undefined) data.quietHoursEnd = input.quietHoursEnd;

    // A channel that is switched on must also be permitted at the owner level.
    if (input.enabledChannels?.includes("VIDEO") && input.allowVideoCalls === false) {
      throw new AppError("BAD_REQUEST", "Enable video calls before adding VIDEO to your channels");
    }

    const user = await prisma.user.update({ where: { id: input.userId }, data: data as never });
    await audit({
      actorUserId: input.userId,
      action: "user.privacy_update",
      resourceType: "user",
      resourceId: input.userId,
      ip: input.ip,
      metadata: { fields: Object.keys(data) },
    });
    return toSafeUser(user);
  },

  async updateName(userId: string, name: string, ip?: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { nameEncrypted: encryptField(name.trim(), "name") },
    });
    await audit({ actorUserId: userId, action: "user.update_name", resourceType: "user", resourceId: userId, ip });
    return toSafeUser(user);
  },

  /**
   * Email is optional contact metadata. It is not exposed to scanners and is
   * stored with a keyed lookup HMAC so it is not enumerable from a dump.
   */
  async addEmail(userId: string, email: string, ip?: string) {
    const normalized = normalizeEmail(email);
    const existing = await prisma.user.findUnique({ where: { emailLookupHmac: lookupHmac(normalized, "email") } });
    if (existing && existing.id !== userId) {
      throw new AppError("CONFLICT", "That email is already linked to another account");
    }
    await authRepository.attachEmail(userId, normalized);
    await audit({ actorUserId: userId, action: "user.add_email", resourceType: "user", resourceId: userId, ip });
    return { email: normalized };
  },

  /**
   * Data export (spec 30, requires re-auth at the route layer). Returns
   * decrypted personal data for the requesting owner only.
   */
  async exportData(userId: string) {
    const user = await authRepository.findById(userId);
    if (!user) throw notFound("Account not found");

    const [assets, tags, vehicles, contacts, communications, locationShares, documents] = await Promise.all([
      prisma.asset.findMany({ where: { ownerId: userId } }),
      prisma.tag.findMany({ where: { ownerId: userId }, select: { id: true, publicTagId: true, tagType: true, status: true, createdAt: true } }),
      prisma.vehicle.findMany({ where: { ownerId: userId } }),
      prisma.emergencyContact.findMany({ where: { ownerId: userId } }),
      prisma.communicationSession.findMany({ where: { ownerId: userId }, select: { id: true, channel: true, status: true, reasonCode: true, createdAt: true } }),
      prisma.locationShare.findMany({ where: { ownerId: userId }, select: { id: true, createdAt: true, expiresAt: true, status: true } }),
      prisma.document.findMany({ where: { ownerId: userId }, select: { id: true, documentType: true, status: true, createdAt: true, expiresAt: true } }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      account: toSafeUser(user),
      assets,
      tags,
      vehicles: vehicles.map((v) => ({
        id: v.id,
        registration: v.registrationEnding,
        make: v.make,
        model: v.model,
        createdAt: v.createdAt,
      })),
      emergencyContacts: contacts.length,
      communications,
      locationShares,
      documents,
      note: "Encrypted fields are exported decrypted for your own account only. Document binaries are not included; request signed download URLs instead.",
    };
  },

  /**
   * Soft delete. Personal identifiers are anonymised immediately while rows are
   * retained for fraud/audit obligations, per the retention policy a super admin
   * configures (spec 4.7, 33).
   */
  async deleteAccount(input: { userId: string; ip?: string; hard?: boolean }) {
    const user = await authRepository.findById(input.userId);
    if (!user) throw notFound("Account not found");

    await prisma.$transaction([
      prisma.tag.updateMany({ where: { ownerId: input.userId, status: "ACTIVE" }, data: { status: "DEACTIVATED", deactivatedAt: new Date() } }),
      prisma.user.update({
        where: { id: input.userId },
        data: {
          status: "DELETED",
          deletedAt: new Date(),
          nameEncrypted: null,
          emailEncrypted: null,
          emailLookupHmac: null,
          pushTokenEncrypted: null,
        },
      }),
      prisma.refreshToken.updateMany({ where: { userId: input.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);

    await audit({
      actorUserId: input.userId,
      action: "user.delete_account",
      resourceType: "user",
      resourceId: input.userId,
      ip: input.ip,
      metadata: { hard: input.hard ?? false },
    });

    return { deleted: true, anonymisedRetained: !input.hard };
  },

  async registerDevice(input: {
    userId: string;
    devicePublicId: string;
    platform: string;
    appVersion?: string;
    pushToken?: string;
  }) {
    const device = await prisma.device.upsert({
      where: { devicePublicId: input.devicePublicId },
      create: {
        userId: input.userId,
        devicePublicId: input.devicePublicId,
        platform: input.platform,
        appVersion: input.appVersion,
        pushTokenEncrypted: input.pushToken ? encryptField(input.pushToken, "push_token") : null,
      },
      update: {
        userId: input.userId,
        appVersion: input.appVersion,
        lastSeenAt: new Date(),
        ...(input.pushToken ? { pushTokenEncrypted: encryptField(input.pushToken, "push_token") } : {}),
      },
    });
    return { devicePublicId: device.devicePublicId, platform: device.platform };
  },

  async assertSelf(userId: string, targetId: string): Promise<void> {
    if (userId !== targetId) throw forbidden("You can only access your own data");
  },
};
