import { prisma } from "../../db/prisma";
import { env } from "../../config";
import { badRequest, conflict, forbidden, notFound } from "../../common/errors";
import { decryptField, encryptField, randomToken } from "../../common/utils/crypto";
import { addMinutes } from "../../common/utils/time";
import { childLogger } from "../../common/logger";
import { scannerService } from "../scanner/scanner.service";
import { audit } from "../audit/audit.service";
import { enqueueNotification } from "../../workers/queues";

const log = childLogger("location");

export const locationService = {
  /**
   * Location is opt-in and owner-approved (spec 16). A scanner can only request;
   * the owner decides whether a share link is ever created.
   */
  async requestShare(input: { sessionToken: string; reasonCode?: string }) {
    const scanner = await scannerService.authorizeSession(input.sessionToken);
    const owner = scanner.tag.owner;

    if (!owner.allowLocationShare) {
      throw forbidden("The owner has not enabled location sharing for this tag");
    }

    const existing = await prisma.locationShareRequest.findFirst({
      where: { scannerSessionId: scanner.id, status: "PENDING" },
    });
    if (existing) return { requestId: existing.id, status: existing.status };

    const request = await prisma.locationShareRequest.create({
      data: { scannerSessionId: scanner.id, ownerId: scanner.tag.ownerId },
    });

    await prisma.tagEvent.create({
      data: { tagId: scanner.tagId, eventType: "LOCATION_SHARED", scannerSessionId: scanner.id, metadata: { requestId: request.id, phase: "REQUESTED" } },
    });

    await enqueueNotification({
      userId: scanner.tag.ownerId,
      kind: "LOCATION_REQUEST",
      payload: { requestId: request.id, title: "Location request", body: "Someone asked for this tag's location." },
    });

    await audit({ action: "location.request", resourceType: "location_share_request", resourceId: request.id, metadata: { tagId: scanner.tagId } });
    return { requestId: request.id, status: request.status };
  },

  async listRequests(ownerId: string) {
    const requests = await prisma.locationShareRequest.findMany({
      where: { ownerId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return requests.map((r) => ({ requestId: r.id, status: r.status, createdAt: r.createdAt }));
  },

  async respond(input: {
    ownerId: string;
    requestId: string;
    approve: boolean;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    ttlMinutes?: number;
    ip?: string;
  }) {
    const request = await prisma.locationShareRequest.findUnique({
      where: { id: input.requestId },
      include: { scannerSession: { include: { tag: true } } },
    });
    if (!request) throw notFound("Location request not found");
    if (request.ownerId !== input.ownerId) throw forbidden("Not your request");

    if (!input.approve) {
      await prisma.locationShareRequest.update({
        where: { id: input.requestId },
        data: { status: "DECLINED", respondedAt: new Date() },
      });
      await audit({ actorUserId: input.ownerId, action: "location.decline", resourceType: "location_share_request", resourceId: input.requestId, ip: input.ip });
      return { requestId: request.id, status: "DECLINED" };
    }

    if (typeof input.latitude !== "number" || typeof input.longitude !== "number") {
      throw badRequest("Provide latitude and longitude when approving");
    }

    const ttl = Math.min(24 * 60, Math.max(5, input.ttlMinutes ?? env.DEFAULT_LOCATION_SHARE_TTL_MINUTES));
    const publicShareId = `loc_${randomToken(16)}`;

    const share = await prisma.locationShare.create({
      data: {
        publicShareId,
        requestId: request.id,
        ownerId: input.ownerId,
        assetId: request.scannerSession.tag.assetId,
        locationCiphertext: encryptField(
          JSON.stringify({ latitude: input.latitude, longitude: input.longitude }),
          "location",
        ),
        accuracyMeters: input.accuracy,
        expiresAt: addMinutes(ttl),
      },
    });

    await prisma.locationShareRequest.update({
      where: { id: input.requestId },
      data: { status: "APPROVED", respondedAt: new Date() },
    });

    await prisma.tagEvent.create({
      data: {
        tagId: request.scannerSession.tagId,
        eventType: "LOCATION_SHARED",
        scannerSessionId: request.scannerSessionId,
        metadata: { shareId: share.id, phase: "GRANTED" },
      },
    });

    await audit({ actorUserId: input.ownerId, action: "location.grant", resourceType: "location_share", resourceId: share.id, ip: input.ip });

    log.info({ shareId: share.id, ttlMinutes: ttl }, "location share granted");
    return { requestId: request.id, status: "APPROVED", shareId: publicShareId, expiresAt: share.expiresAt, ttlMinutes: ttl };
  },

  /**
   * Public resolve of a share link. The link is single-purpose, time-limited and
   * reveals only coordinates — never the owner's identity or address.
   */
  async resolveShare(publicShareId: string) {
    const share = await prisma.locationShare.findUnique({ where: { publicShareId } });
    if (!share) throw notFound("This location link is not valid");
    if (share.status !== "ACTIVE") throw conflict("This location link is no longer available");
    if (share.expiresAt.getTime() <= Date.now()) {
      await prisma.locationShare.update({ where: { id: share.id }, data: { status: "EXPIRED" } });
      throw conflict("This location link has expired");
    }

    await prisma.locationShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 } },
    });

    const { latitude, longitude } = JSON.parse(decryptField(share.locationCiphertext, "location")) as {
      latitude: number;
      longitude: number;
    };

    return {
      latitude,
      longitude,
      accuracyMeters: share.accuracyMeters,
      expiresAt: share.expiresAt,
    };
  },

  async revoke(shareId: string, ownerId: string, ip?: string) {
    const share = await prisma.locationShare.findUnique({ where: { id: shareId } });
    if (!share) throw notFound("Location share not found");
    if (share.ownerId !== ownerId) throw forbidden("Not your share");

    await prisma.locationShare.update({ where: { id: shareId }, data: { status: "REVOKED" } });
    await audit({ actorUserId: ownerId, action: "location.revoke", resourceType: "location_share", resourceId: shareId, ip });
  },
};
