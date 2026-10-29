"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoService = void 0;
const prisma_1 = require("../../../db/prisma");
const config_1 = require("../../../config");
const errors_1 = require("../../../common/errors");
const crypto_1 = require("../../../common/utils/crypto");
const time_1 = require("../../../common/utils/time");
const logger_1 = require("../../../common/logger");
const scanner_service_1 = require("../../scanner/scanner.service");
const audit_service_1 = require("../../audit/audit.service");
const log = (0, logger_1.childLogger)("video");
exports.videoService = {
    async createVideoSession(input) {
        const scanner = await scanner_service_1.scannerService.authorizeSession(input.scannerSessionId);
        if (scanner.id !== input.scannerSessionId) {
            throw (0, errors_1.forbidden)("Session mismatch");
        }
        const publicSessionId = `vid_${(0, crypto_1.randomToken)(12)}`;
        const roomId = `room_${(0, crypto_1.randomToken)(16)}`;
        const roomToken = (0, crypto_1.randomToken)(32);
        const session = await prisma_1.prisma.communicationSession.create({
            data: {
                publicSessionId,
                tagId: input.tagId,
                ownerId: input.ownerId,
                scannerSessionId: input.scannerSessionId,
                channel: "VIDEO",
                status: "CREATED",
                reasonCode: input.reasonCode,
                provider: "webrtc",
                providerSessionId: roomId,
                relayReference: roomToken,
                riskScore: scanner.riskScore,
                requiresOtp: false,
                expiresAt: (0, time_1.addMinutes)(15),
            },
        });
        await prisma_1.prisma.tagEvent.create({
            data: {
                tagId: input.tagId,
                eventType: "CALL_STARTED",
                scannerSessionId: input.scannerSessionId,
                metadata: { communicationSessionId: session.id, reasonCode: input.reasonCode, channel: "VIDEO" },
            },
        });
        await (0, audit_service_1.audit)({
            action: "communication.start",
            resourceType: "communication_session",
            resourceId: session.id,
            ip: input.ip,
            metadata: { channel: "VIDEO", tagId: input.tagId, roomId },
        });
        const iceServers = await this.getIceServers();
        log.info({ sessionId: session.id, roomId }, "video session created");
        return {
            sessionId: session.publicSessionId,
            roomId,
            roomToken,
            iceServers,
            expiresAt: session.expiresAt,
        };
    },
    async getIceServers() {
        const servers = [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
        ];
        if (config_1.env.TURN_URL && config_1.env.TURN_USERNAME && config_1.env.TURN_CREDENTIAL) {
            servers.push({
                urls: config_1.env.TURN_URL,
                username: config_1.env.TURN_USERNAME,
                credential: config_1.env.TURN_CREDENTIAL,
            });
        }
        return servers;
    },
    async joinRoom(input) {
        const session = await prisma_1.prisma.communicationSession.findFirst({
            where: { providerSessionId: input.roomId },
            include: { tag: { include: { owner: true } } },
        });
        if (!session)
            throw (0, errors_1.notFound)("Room not found");
        if (session.channel !== "VIDEO")
            throw (0, errors_1.badRequest)("Not a video session");
        if (session.relayReference !== input.roomToken)
            throw (0, errors_1.forbidden)("Invalid room token");
        if (session.expiresAt.getTime() <= Date.now())
            throw (0, errors_1.badRequest)("Session expired");
        if (input.isOwner) {
            if (session.ownerId !== input.userId)
                throw (0, errors_1.forbidden)("Not the owner");
        }
        else {
            if (session.scannerSessionId !== input.userId)
                throw (0, errors_1.forbidden)("Not the scanner");
        }
        await prisma_1.prisma.communicationSession.update({
            where: { id: session.id },
            data: { status: "ACTIVE", startedAt: new Date() },
        });
        const iceServers = await this.getIceServers();
        return {
            sessionId: session.publicSessionId,
            roomId: session.providerSessionId,
            iceServers,
            isOwner: input.isOwner,
            otherParty: input.isOwner ? "scanner" : "owner",
        };
    },
    async leaveRoom(input) {
        const session = await prisma_1.prisma.communicationSession.findFirst({
            where: { providerSessionId: input.roomId },
        });
        if (!session)
            return;
        await prisma_1.prisma.communicationSession.update({
            where: { id: session.id },
            data: { status: "COMPLETED", endedAt: new Date() },
        });
        await prisma_1.prisma.tagEvent.create({
            data: {
                tagId: session.tagId,
                eventType: "CALL_ENDED",
                metadata: { sessionId: session.id, channel: "VIDEO" },
            },
        });
    },
    async getSessionForOwner(ownerId, sessionId) {
        const session = await prisma_1.prisma.communicationSession.findUnique({
            where: { publicSessionId: sessionId },
        });
        if (!session || session.ownerId !== ownerId)
            throw (0, errors_1.notFound)("Session not found");
        return session;
    },
    async getSessionForScanner(scannerSessionId, sessionId) {
        const session = await prisma_1.prisma.communicationSession.findUnique({
            where: { publicSessionId: sessionId },
        });
        if (!session || session.scannerSessionId !== scannerSessionId)
            throw (0, errors_1.notFound)("Session not found");
        return session;
    },
};
//# sourceMappingURL=video.service.js.map