"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.locationService = void 0;
const prisma_1 = require("../../db/prisma");
const config_1 = require("../../config");
const errors_1 = require("../../common/errors");
const crypto_1 = require("../../common/utils/crypto");
const time_1 = require("../../common/utils/time");
const logger_1 = require("../../common/logger");
const scanner_service_1 = require("../scanner/scanner.service");
const audit_service_1 = require("../audit/audit.service");
const queues_1 = require("../../workers/queues");
const log = (0, logger_1.childLogger)("location");
exports.locationService = {
    /**
     * Location is opt-in and owner-approved (spec 16). A scanner can only request;
     * the owner decides whether a share link is ever created.
     */
    async requestShare(input) {
        const scanner = await scanner_service_1.scannerService.authorizeSession(input.sessionToken);
        const owner = scanner.tag.owner;
        if (!owner.allowLocationShare) {
            throw (0, errors_1.forbidden)("The owner has not enabled location sharing for this tag");
        }
        const existing = await prisma_1.prisma.locationShareRequest.findFirst({
            where: { scannerSessionId: scanner.id, status: "PENDING" },
        });
        if (existing)
            return { requestId: existing.id, status: existing.status };
        const request = await prisma_1.prisma.locationShareRequest.create({
            data: { scannerSessionId: scanner.id, ownerId: scanner.tag.ownerId },
        });
        await prisma_1.prisma.tagEvent.create({
            data: { tagId: scanner.tagId, eventType: "LOCATION_SHARED", scannerSessionId: scanner.id, metadata: { requestId: request.id, phase: "REQUESTED" } },
        });
        await (0, queues_1.enqueueNotification)({
            userId: scanner.tag.ownerId,
            kind: "LOCATION_REQUEST",
            payload: { requestId: request.id, title: "Location request", body: "Someone asked for this tag's location." },
        });
        await (0, audit_service_1.audit)({ action: "location.request", resourceType: "location_share_request", resourceId: request.id, metadata: { tagId: scanner.tagId } });
        return { requestId: request.id, status: request.status };
    },
    async listRequests(ownerId) {
        const requests = await prisma_1.prisma.locationShareRequest.findMany({
            where: { ownerId, status: "PENDING" },
            orderBy: { createdAt: "desc" },
            take: 50,
        });
        return requests.map((r) => ({ requestId: r.id, status: r.status, createdAt: r.createdAt }));
    },
    async respond(input) {
        const request = await prisma_1.prisma.locationShareRequest.findUnique({
            where: { id: input.requestId },
            include: { scannerSession: { include: { tag: true } } },
        });
        if (!request)
            throw (0, errors_1.notFound)("Location request not found");
        if (request.ownerId !== input.ownerId)
            throw (0, errors_1.forbidden)("Not your request");
        if (!input.approve) {
            await prisma_1.prisma.locationShareRequest.update({
                where: { id: input.requestId },
                data: { status: "DECLINED", respondedAt: new Date() },
            });
            await (0, audit_service_1.audit)({ actorUserId: input.ownerId, action: "location.decline", resourceType: "location_share_request", resourceId: input.requestId, ip: input.ip });
            return { requestId: request.id, status: "DECLINED" };
        }
        if (typeof input.latitude !== "number" || typeof input.longitude !== "number") {
            throw (0, errors_1.badRequest)("Provide latitude and longitude when approving");
        }
        const ttl = Math.min(24 * 60, Math.max(5, input.ttlMinutes ?? config_1.env.DEFAULT_LOCATION_SHARE_TTL_MINUTES));
        const publicShareId = `loc_${(0, crypto_1.randomToken)(16)}`;
        const share = await prisma_1.prisma.locationShare.create({
            data: {
                publicShareId,
                requestId: request.id,
                ownerId: input.ownerId,
                assetId: request.scannerSession.tag.assetId,
                locationCiphertext: (0, crypto_1.encryptField)(JSON.stringify({ latitude: input.latitude, longitude: input.longitude }), "location"),
                accuracyMeters: input.accuracy,
                expiresAt: (0, time_1.addMinutes)(ttl),
            },
        });
        await prisma_1.prisma.locationShareRequest.update({
            where: { id: input.requestId },
            data: { status: "APPROVED", respondedAt: new Date() },
        });
        await prisma_1.prisma.tagEvent.create({
            data: {
                tagId: request.scannerSession.tagId,
                eventType: "LOCATION_SHARED",
                scannerSessionId: request.scannerSessionId,
                metadata: { shareId: share.id, phase: "GRANTED" },
            },
        });
        await (0, audit_service_1.audit)({ actorUserId: input.ownerId, action: "location.grant", resourceType: "location_share", resourceId: share.id, ip: input.ip });
        log.info({ shareId: share.id, ttlMinutes: ttl }, "location share granted");
        return { requestId: request.id, status: "APPROVED", shareId: publicShareId, expiresAt: share.expiresAt, ttlMinutes: ttl };
    },
    /**
     * Public resolve of a share link. The link is single-purpose, time-limited and
     * reveals only coordinates — never the owner's identity or address.
     */
    async resolveShare(publicShareId) {
        const share = await prisma_1.prisma.locationShare.findUnique({ where: { publicShareId } });
        if (!share)
            throw (0, errors_1.notFound)("This location link is not valid");
        if (share.status !== "ACTIVE")
            throw (0, errors_1.conflict)("This location link is no longer available");
        if (share.expiresAt.getTime() <= Date.now()) {
            await prisma_1.prisma.locationShare.update({ where: { id: share.id }, data: { status: "EXPIRED" } });
            throw (0, errors_1.conflict)("This location link has expired");
        }
        await prisma_1.prisma.locationShare.update({
            where: { id: share.id },
            data: { viewCount: { increment: 1 } },
        });
        const { latitude, longitude } = JSON.parse((0, crypto_1.decryptField)(share.locationCiphertext, "location"));
        return {
            latitude,
            longitude,
            accuracyMeters: share.accuracyMeters,
            expiresAt: share.expiresAt,
        };
    },
    async revoke(shareId, ownerId, ip) {
        const share = await prisma_1.prisma.locationShare.findUnique({ where: { id: shareId } });
        if (!share)
            throw (0, errors_1.notFound)("Location share not found");
        if (share.ownerId !== ownerId)
            throw (0, errors_1.forbidden)("Not your share");
        await prisma_1.prisma.locationShare.update({ where: { id: shareId }, data: { status: "REVOKED" } });
        await (0, audit_service_1.audit)({ actorUserId: ownerId, action: "location.revoke", resourceType: "location_share", resourceId: shareId, ip });
    },
};
//# sourceMappingURL=location.service.js.map