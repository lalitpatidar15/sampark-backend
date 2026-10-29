import { prisma } from "../../../db/prisma";
import { env } from "../../../config";
import { badRequest, forbidden, notFound } from "../../../common/errors";
import { randomToken, sha256 } from "../../../common/utils/crypto";
import { addMinutes } from "../../../common/utils/time";
import { childLogger } from "../../../common/logger";
import { scannerService } from "../../scanner/scanner.service";
import { audit } from "../../audit/audit.service";

const log = childLogger("video");

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const videoService = {
  async createVideoSession(input: {
    scannerSessionId: string;
    ownerId: string;
    tagId: string;
    reasonCode: string;
    ip?: string;
  }) {
    const scanner = await scannerService.authorizeSession(input.scannerSessionId);
    if (scanner.id !== input.scannerSessionId) {
      throw forbidden("Session mismatch");
    }

    const publicSessionId = `vid_${randomToken(12)}`;
    const roomId = `room_${randomToken(16)}`;
    const roomToken = randomToken(32);

    const session = await prisma.communicationSession.create({
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
        expiresAt: addMinutes(15),
      },
    });

    await prisma.tagEvent.create({
      data: {
        tagId: input.tagId,
        eventType: "CALL_STARTED",
        scannerSessionId: input.scannerSessionId,
        metadata: { communicationSessionId: session.id, reasonCode: input.reasonCode, channel: "VIDEO" },
      },
    });

    await audit({
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

  async getIceServers(): Promise<IceServer[]> {
    const servers: IceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];

    if (env.TURN_URL && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
      servers.push({
        urls: env.TURN_URL,
        username: env.TURN_USERNAME,
        credential: env.TURN_CREDENTIAL,
      });
    }

    return servers;
  },

  async joinRoom(input: { roomId: string; roomToken: string; userId: string; isOwner: boolean }) {
    const session = await prisma.communicationSession.findFirst({
      where: { providerSessionId: input.roomId },
      include: { tag: { include: { owner: true } } },
    });

    if (!session) throw notFound("Room not found");
    if (session.channel !== "VIDEO") throw badRequest("Not a video session");
    if (session.relayReference !== input.roomToken) throw forbidden("Invalid room token");
    if (session.expiresAt.getTime() <= Date.now()) throw badRequest("Session expired");

    if (input.isOwner) {
      if (session.ownerId !== input.userId) throw forbidden("Not the owner");
    } else {
      if (session.scannerSessionId !== input.userId) throw forbidden("Not the scanner");
    }

    await prisma.communicationSession.update({
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

  async leaveRoom(input: { roomId: string; userId: string }) {
    const session = await prisma.communicationSession.findFirst({
      where: { providerSessionId: input.roomId },
    });

    if (!session) return;

    await prisma.communicationSession.update({
      where: { id: session.id },
      data: { status: "COMPLETED", endedAt: new Date() },
    });

    await prisma.tagEvent.create({
      data: {
        tagId: session.tagId,
        eventType: "CALL_ENDED",
        metadata: { sessionId: session.id, channel: "VIDEO" },
      },
    });
  },

  async getSessionForOwner(ownerId: string, sessionId: string) {
    const session = await prisma.communicationSession.findUnique({
      where: { publicSessionId: sessionId },
    });
    if (!session || session.ownerId !== ownerId) throw notFound("Session not found");
    return session;
  },

  async getSessionForScanner(scannerSessionId: string, sessionId: string) {
    const session = await prisma.communicationSession.findUnique({
      where: { publicSessionId: sessionId },
    });
    if (!session || session.scannerSessionId !== scannerSessionId) throw notFound("Session not found");
    return session;
  },
};