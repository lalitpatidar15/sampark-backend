import { prisma } from "../../db/prisma";
import { forbidden, notFound } from "../../common/errors";
import { buildMeta, parsePagination } from "../../common/utils/pagination";
import { audit } from "../audit/audit.service";
import { enqueueFraudReview } from "../../workers/queues";
import { childLogger } from "../../common/logger";
import { qrSizeService } from "../qr-sizes/qr-size.service";
import { nfcService } from "../nfc/nfc.service";
import { geofenceService } from "../geofence/geofence.service";
import { sha256 } from "../../common/utils/crypto";

const log = childLogger("admin");

/**
 * Support-safe projections. Support agents (spec 4.5) must not have
 * unrestricted access to private phone, address or document fields, so these
 * queries never select the encrypted columns and only ever return masked
 * fragments such as a phone's last four digits.
 */
export const adminService = {
  async dashboard(actorRole: string) {
    const since24h = new Date(Date.now() - 86_400_000);

    const [users, activeTags, sessions24h, communications24h, openAlerts, openTickets] = await Promise.all([
      prisma.user.count({ where: { status: "ACTIVE" } }),
      prisma.tag.count({ where: { status: "ACTIVE" } }),
      prisma.scannerSession.count({ where: { createdAt: { gt: since24h } } }),
      prisma.communicationSession.count({ where: { createdAt: { gt: since24h } } }),
      prisma.emergencyAlert.count({ where: { status: "RAISED" } }),
      prisma.supportTicket.count({ where: { status: "OPEN" } }),
    ]);

    const byChannel = await prisma.communicationSession.groupBy({
      by: ["channel"],
      where: { createdAt: { gt: since24h } },
      _count: { _all: true },
    });

    return {
      users,
      activeTags,
      last24h: { scannerSessions: sessions24h, communications: communications24h },
      emergencyAlertsOpen: openAlerts,
      supportTicketsOpen: openTickets,
      communicationsByChannel: Object.fromEntries(byChannel.map((r) => [r.channel, r._count._all])),
      viewerRole: actorRole,
    };
  },

  /** Support-safe user list: no encrypted identifiers are selected. */
  async listUsers(query: Record<string, unknown>) {
    const pagination = parsePagination(query);
    const status = typeof query.status === "string" ? query.status : undefined;
    const role = typeof query.role === "string" ? query.role : undefined;

    const where = {
      ...(status ? { status: status as never } : {}),
      ...(role ? { role: role as never } : {}),
      deletedAt: null,
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          publicId: true,
          role: true,
          status: true,
          // Only the tail of the phone HMAC, so support can confirm an account
          // without ever learning the number.
          phoneLookupHmac: true,
          enabledChannels: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: pagination.limit,
        skip: pagination.skip,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      items: items.map((u) => ({
        id: u.id,
        publicId: u.publicId,
        role: u.role,
        status: u.status,
        phoneTail: u.phoneLookupHmac.slice(-4),
        enabledChannels: u.enabledChannels,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      })),
      meta: buildMeta(total, pagination),
    };
  },

  async setUserStatus(input: {
    actorUserId: string;
    actorRole: string;
    userId: string;
    status: "ACTIVE" | "SUSPENDED";
    reason: string;
    ip?: string;
  }) {
    const target = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!target) throw notFound("User not found");

    // Privilege escalation guard: an admin cannot suspend a peer or a super admin.
    if (target.role === "SUPER_ADMIN" && input.actorRole !== "SUPER_ADMIN") {
      throw forbidden("Only a super admin can change a super admin account");
    }
    if (target.id === input.actorUserId) {
      throw forbidden("You cannot change your own account status");
    }

    const updated = await prisma.user.update({ where: { id: input.userId }, data: { status: input.status } });
    await prisma.refreshToken.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await audit({
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: `admin.user.${input.status === "SUSPENDED" ? "suspend" : "reinstate"}`,
      resourceType: "user",
      resourceId: input.userId,
      ip: input.ip,
      metadata: { reason: input.reason },
    });

    return { id: updated.id, status: updated.status };
  },

  /**
   * Tag suspension (spec 4.5/4.6). This is the abuse-response lever: it
   * immediately stops the privacy gateway from resolving the tag.
   */
  async suspendTag(input: {
    actorUserId: string;
    actorRole: string;
    tagId: string;
    reason: string;
    ip?: string;
  }) {
    const tag = await prisma.tag.findUnique({ where: { id: input.tagId } });
    if (!tag) throw notFound("Tag not found");

    const updated = await prisma.tag.update({ where: { id: input.tagId }, data: { status: "SUSPENDED" } });
    await prisma.tagEvent.create({ data: { tagId: input.tagId, eventType: "TAG_DEACTIVATED", metadata: { reason: input.reason, by: "admin" } } });

    await audit({
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: "admin.tag.suspend",
      resourceType: "tag",
      resourceId: input.tagId,
      ip: input.ip,
      metadata: { reason: input.reason },
    });

    log.warn({ tagId: input.tagId, reason: input.reason }, "tag suspended by admin");
    return { id: updated.id, status: updated.status };
  },

  async listTags(query: Record<string, unknown>) {
    const pagination = parsePagination(query);
    const status = typeof query.status === "string" ? query.status : undefined;

    const where = { ...(status ? { status: status as never } : {}), deletedAt: null };
    const [items, total] = await Promise.all([
      prisma.tag.findMany({
        where,
        select: {
          id: true,
          publicTagId: true,
          tagType: true,
          status: true,
          label: true,
          activatedAt: true,
          createdAt: true,
          owner: { select: { publicId: true, role: true, status: true } },
          asset: { select: { assetType: true, displayName: true } },
          _count: { select: { scannerSessions: true, communicationSessions: true } },
        },
        orderBy: { createdAt: "desc" },
        take: pagination.limit,
        skip: pagination.skip,
      }),
      prisma.tag.count({ where }),
    ]);

    return { items, meta: buildMeta(total, pagination) };
  },
  async listCommunications(query: Record<string, unknown>) {
    const pagination = parsePagination(query);
    const channel = typeof query.channel === "string" ? query.channel : undefined;
    const status = typeof query.status === "string" ? query.status : undefined;

    const where = {
      ...(channel ? { channel: channel as never } : {}),
      ...(status ? { status: status as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.communicationSession.findMany({
        where,
        select: {
          id: true,
          publicSessionId: true,
          channel: true,
          status: true,
          reasonCode: true,
          provider: true,
          riskScore: true,
          requiresOtp: true,
          startedAt: true,
          endedAt: true,
          createdAt: true,
          // No message bodies and no relay numbers here.
          tag: { select: { publicTagId: true, tagType: true } },
          owner: { select: { publicId: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { createdAt: "desc" },
        take: pagination.limit,
        skip: pagination.skip,
      }),
      prisma.communicationSession.count({ where }),
    ]);

    return { items, meta: buildMeta(total, pagination) };
  },

  async listAbuseReports(query: Record<string, unknown>) {
    const pagination = parsePagination(query);
    const state = typeof query.state === "string" ? query.state : undefined;
    const where = state ? { state } : {};

    const [items, total] = await Promise.all([
      prisma.abuseReport.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: pagination.limit,
        skip: pagination.skip,
      }),
      prisma.abuseReport.count({ where }),
    ]);

    return { items, meta: buildMeta(total, pagination) };
  },

  /**
   * Platform-wide emergency feed for the operations console.
   *
   * Follows the same rule as the rest of this service: the scanner's identity,
   * free-text note and location are deliberately omitted. A support agent gets
   * enough to act on the alert, not enough to profile whoever raised it.
   */
  async listEmergencies(query: Record<string, unknown>) {
    const pagination = parsePagination(query);
    const status = typeof query.status === "string" ? query.status : undefined;

    const where = {
      ...(status ? { status: status as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.emergencyAlert.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: pagination.limit,
        skip: pagination.skip,
        select: {
          id: true,
          status: true,
          reasonCode: true,
          riskScore: true,
          // How many emergency contacts were actually reached, not who they are.
          notifiedContactIds: true,
          createdAt: true,
          resolvedAt: true,
          ownerId: true,
          scannerSession: {
            select: {
              riskState: true,
              phoneVerified: true,
              tag: { select: { publicTagId: true, tagType: true, status: true } },
            },
          },
        },
      }),
      prisma.emergencyAlert.count({ where }),
    ]);

    return { items, meta: buildMeta(total, pagination) };
  },

  /**
   * Staff-initiated resolution, for when the owner is unreachable. Distinct from
   * the owner's own resolve path so the audit log shows who actually closed it.
   */
  async resolveEmergency(input: { alertId: string; actorUserId: string; note?: string; ip?: string }) {
    const alert = await prisma.emergencyAlert.findUnique({ where: { id: input.alertId } });
    if (!alert) throw notFound("That emergency alert does not exist");
    if (alert.status === "RESOLVED") return { id: alert.id, status: alert.status };

    const updated = await prisma.emergencyAlert.update({
      where: { id: alert.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
      select: { id: true, status: true, resolvedAt: true },
    });

    await audit({
      actorUserId: input.actorUserId,
      action: "admin.emergency.resolve",
      resourceType: "emergency_alert",
      resourceId: alert.id,
      ip: input.ip,
      metadata: { note: input.note, ownerId: alert.ownerId },
    });

    return updated;
  },

  async listAuditLogs(query: Record<string, unknown>) {
    const pagination = parsePagination(query);
    const action = typeof query.action === "string" ? query.action : undefined;
    const where = action ? { action: { contains: action } } : {};

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: pagination.limit,
        skip: pagination.skip,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { items, meta: buildMeta(total, pagination) };
  },

  async analytics(query: Record<string, unknown>) {
    const days = Math.min(90, Math.max(1, Number(query.days) || 30));
    const since = new Date(Date.now() - days * 86_400_000);

    const metrics = await prisma.dailyMetric.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "asc" },
    });

    const series: Record<string, { date: string; value: number }[]> = {};
    for (const metric of metrics) {
      const date = metric.date.toISOString().slice(0, 10);
      (series[metric.metric] ??= []).push({ date, value: metric.value });
    }

    return { days, series };
  },

  async providers() {
    return prisma.providerConfig.findMany({
      select: { key: true, providerType: true, isActive: true, updatedAt: true },
      orderBy: { providerType: "asc" },
    });
  },

  /**
   * Super-admin-only. Credentials are never returned; only a vault reference
   * and non-secret configuration (spec 4.7, 9.1).
   */
  async setProviderActive(input: {
    actorUserId: string;
    key: string;
    isActive: boolean;
    secretRef?: string;
    ip?: string;
  }) {
    const config = await prisma.providerConfig.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        providerType: input.key.split(":")[0]?.toUpperCase() ?? "OTHER",
        isActive: input.isActive,
        secretRef: input.secretRef,
        updatedBy: input.actorUserId,
      },
      update: { isActive: input.isActive, secretRef: input.secretRef, updatedBy: input.actorUserId },
      select: { key: true, providerType: true, isActive: true, secretRef: true },
    });

    await audit({
      actorUserId: input.actorUserId,
      action: "admin.provider.update",
      resourceType: "provider_config",
      resourceId: input.key,
      ip: input.ip,
      metadata: { isActive: input.isActive },
    });

    return config;
  },

  async reviewAbuse(input: { actorUserId: string; reportId: string; state: string; actionTaken?: string; ip?: string }) {
    const report = await prisma.abuseReport.findUnique({ where: { id: input.reportId } });
    if (!report) throw notFound("Abuse report not found");

    const updated = await prisma.abuseReport.update({
      where: { id: input.reportId },
      data: { state: input.state, actionTaken: input.actionTaken, resolvedAt: new Date() },
    });

    if (input.state === "CONFIRMED" && report.tagId) {
      await enqueueFraudReview({ tagId: report.tagId, reason: "abuse_confirmed" });
    }

    await audit({
      actorUserId: input.actorUserId,
      action: "admin.abuse.review",
      resourceType: "abuse_report",
      resourceId: input.reportId,
      ip: input.ip,
      metadata: { state: input.state },
    });

    return { id: updated.id, state: updated.state };
  },

  async featureFlags() {
    return prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  },

  async setFeatureFlag(input: { actorUserId: string; key: string; enabled: boolean; ip?: string }) {
    const flag = await prisma.featureFlag.upsert({
      where: { key: input.key },
      create: { key: input.key, enabled: input.enabled, updatedBy: input.actorUserId },
      update: { enabled: input.enabled, updatedBy: input.actorUserId },
    });
    await audit({
      actorUserId: input.actorUserId,
      action: "admin.feature_flag.update",
      resourceType: "feature_flag",
      resourceId: input.key,
      ip: input.ip,
      metadata: { enabled: input.enabled },
    });
    return flag;
  },

  // QR Size management
  async listQrSizes() {
    return qrSizeService.list();
  },

  async createQrSize(input: {
    actorUserId: string;
    size: number;
    label: string;
    isActive?: boolean;
    sortOrder?: number;
    description?: string;
    ip?: string;
  }) {
    return qrSizeService.create({ ...input, actorUserId: input.actorUserId, ip: input.ip });
  },

  async updateQrSize(input: {
    actorUserId: string;
    id: string;
    patch: Partial<{ label: string; isActive: boolean; sortOrder: number; description: string }>;
    ip?: string;
  }) {
    return qrSizeService.update({ ...input, actorUserId: input.actorUserId, ip: input.ip });
  },

  async deleteQrSize(input: { actorUserId: string; id: string; ip?: string }) {
    return qrSizeService.delete({ ...input, actorUserId: input.actorUserId, ip: input.ip });
  },

  async getActiveQrSizes() {
    return qrSizeService.getActive();
  },

  // --- NFC admin ---
  async listNfcTags(query: Record<string, unknown>) {
    const pagination = parsePagination(query);
    const [items, total] = await Promise.all([
      prisma.tag.findMany({
        where: { nfcUidHash: { not: null }, deletedAt: null },
        select: {
          id: true,
          publicTagId: true,
          tagType: true,
          status: true,
          nfcUidHash: true,
          owner: { select: { publicId: true } },
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: pagination.limit,
        skip: pagination.skip,
      }),
      prisma.tag.count({ where: { nfcUidHash: { not: null }, deletedAt: null } }),
    ]);
    return {
      items: items.map((t) => ({
        id: t.id,
        publicTagId: t.publicTagId,
        tagType: t.tagType,
        status: t.status,
        nfcUidHash: t.nfcUidHash,
        nfcUidTail: t.nfcUidHash?.slice(-8),
        ownerId: t.owner.publicId,
        createdAt: t.createdAt,
      })),
      meta: buildMeta(total, pagination),
    };
  },

  async linkNfcTag(input: {
    actorUserId: string;
    tagId: string;
    nfcUid: string;
    ip?: string;
  }) {
    const tag = await prisma.tag.findUnique({ where: { id: input.tagId } });
    if (!tag) throw notFound("Tag not found");

    const uidHash = sha256(`nfc:${input.nfcUid.trim()}`);

    const existing = await prisma.tag.findFirst({
      where: { nfcUidHash: uidHash, id: { not: input.tagId } },
    });
    if (existing) {
      throw forbidden("This NFC UID is already bound to another tag");
    }

    const updated = await prisma.tag.update({
      where: { id: input.tagId },
      data: { nfcUidHash: uidHash },
    });

    await audit({
      actorUserId: input.actorUserId,
      action: "admin.nfc.link",
      resourceType: "tag",
      resourceId: input.tagId,
      ip: input.ip,
      metadata: { nfcUidHash: uidHash },
    });

    return { id: updated.id, nfcUidHash: updated.nfcUidHash };
  },

  async unlinkNfcTag(input: { actorUserId: string; tagId: string; ip?: string }) {
    const tag = await prisma.tag.findUnique({ where: { id: input.tagId } });
    if (!tag) throw notFound("Tag not found");
    if (!tag.nfcUidHash) throw forbidden("Tag has no NFC UID linked");

    await prisma.tag.update({ where: { id: input.tagId }, data: { nfcUidHash: null } });

    await audit({
      actorUserId: input.actorUserId,
      action: "admin.nfc.unlink",
      resourceType: "tag",
      resourceId: input.tagId,
      ip: input.ip,
      metadata: { nfcUidHash: tag.nfcUidHash },
    });

    return { id: tag.id, unlinked: true };
  },

  // --- Geo-fence admin ---
  async listGeofences(query: Record<string, unknown>) {
    const pagination = parsePagination(query);
    const [items, total] = await Promise.all([
      prisma.geofence.findMany({
        include: {
          tag: {
            select: { publicTagId: true, tagType: true, status: true, owner: { select: { publicId: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        take: pagination.limit,
        skip: pagination.skip,
      }),
      prisma.geofence.count(),
    ]);
    return {
      items: items.map((g) => ({
        id: g.id,
        tagId: g.tagId,
        publicTagId: g.tag.publicTagId,
        tagType: g.tag.tagType,
        tagStatus: g.tag.status,
        ownerId: g.tag.owner.publicId,
        radiusMeters: g.radiusMeters,
        enabled: g.enabled,
        alertOnProximity: g.alertOnProximity,
        lastTriggeredAt: g.lastTriggeredAt,
        createdAt: g.createdAt,
      })),
      meta: buildMeta(total, pagination),
    };
  },

  async upsertGeofence(input: {
    actorUserId: string;
    tagId: string;
    latitude: number;
    longitude: number;
    radiusMeters?: number;
    allowedChannels?: ("CHAT" | "VOICE")[];
    activeSchedule?: string;
    cooldownMinutes?: number;
    alertOnProximity?: boolean;
    enabled?: boolean;
    ip?: string;
  }) {
    return geofenceService.upsert({
      tagId: input.tagId,
      ownerId: input.actorUserId, // admin acts as the actor; ownership enforced by admin role
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      allowedChannels: input.allowedChannels,
      activeSchedule: input.activeSchedule,
      cooldownMinutes: input.cooldownMinutes,
      alertOnProximity: input.alertOnProximity,
      enabled: input.enabled,
      ip: input.ip,
    });
  },

  async removeGeofence(input: { actorUserId: string; tagId: string; ip?: string }) {
    const tag = await prisma.tag.findUnique({ where: { id: input.tagId } });
    if (!tag) throw notFound("Tag not found");
    const existing = await prisma.geofence.findUnique({ where: { tagId: input.tagId } });
    if (!existing) throw forbidden("No geofence configured for this tag");

    await prisma.geofence.delete({ where: { tagId: input.tagId } });

    await audit({
      actorUserId: input.actorUserId,
      action: "admin.geofence.delete",
      resourceType: "geofence",
      resourceId: input.tagId,
      ip: input.ip,
      metadata: { tagId: input.tagId },
    });

    return { removed: true };
  },
};
