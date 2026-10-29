import { Channel, CommunicationStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { env } from "../../config";
import { AppError, badRequest, forbidden, notFound } from "../../common/errors";
import { decryptField, encryptField, randomToken, sha256 } from "../../common/utils/crypto";
import { addHours, addMinutes } from "../../common/utils/time";
import { childLogger } from "../../common/logger";
import { smsProvider, voiceProvider, whatsappProvider } from "../../providers";
import { scannerService } from "../scanner/scanner.service";
import { tagService } from "../tags/tag.service";
import { audit } from "../audit/audit.service";
import { enqueueCommunicationJob } from "../../workers/queues";

const log = childLogger("communication");

export type ChannelName = "VOICE" | "VIDEO" | "SMS" | "WHATSAPP" | "CHAT";

/** Session lifetimes per channel (spec 10.2, 13). */
const TTL: Record<ChannelName, () => Date> = {
  VOICE: () => addMinutes(Math.max(5, Math.ceil(env.MAX_CALL_DURATION_SECONDS / 60))),
  VIDEO: () => addMinutes(15),
  SMS: () => addMinutes(30),
  WHATSAPP: () => addHours(24),
  CHAT: () => addHours(env.DEFAULT_CHAT_TTL_HOURS),
};

export const communicationService = {
  /**
   * The privacy gateway's single write path for scanner-initiated contact.
   *
   * Order matters: validate the session, enforce the owner channel policy, apply
   * abuse controls, only then create a session and dispatch. Real numbers are
   * never returned to the scanner.
   */
  async startFromScanner(input: {
    sessionToken: string;
    reasonCode: string;
    channel: ChannelName;
    ip?: string;
    userAgent?: string;
  }) {
    const scanner = await scannerService.authorizeSession(input.sessionToken);
    await scannerService.assertSessionActionBudget(scanner.id);

    const tag = scanner.tag;
    const owner = tag.owner;

    if (!tagService.reasonIsAllowed(input.reasonCode, tag.asset?.assetType ?? null)) {
      throw badRequest("That reason is not available for this tag");
    }

    if (!owner.enabledChannels.includes(input.channel)) {
      throw new AppError("CHANNEL_DISABLED", `The owner has not enabled ${input.channel.toLowerCase()} contact`);
    }
    if (input.channel === "VIDEO" && !owner.allowVideoCalls) {
      throw new AppError("CHANNEL_DISABLED", "The owner has not enabled video calls");
    }
    if (input.channel === "VOICE" && !owner.allowUnknownCallers) {
      throw new AppError("CHANNEL_DISABLED", "The owner is not accepting calls right now");
    }

    // High-risk sessions must verify a phone before we allocate a relay number.
    const requiresOtp = scannerService.requiresOtp(scanner);
    if (requiresOtp && (input.channel === "VOICE" || input.channel === "VIDEO")) {
      throw new AppError(
        "REAUTH_REQUIRED",
        "Please verify your phone number before making a call",
      );
    }

    // One live session per channel per scanner session.
    const existing = await prisma.communicationSession.findFirst({
      where: {
        scannerSessionId: scanner.id,
        channel: input.channel as Channel,
        status: { in: [CommunicationStatus.CREATED, CommunicationStatus.PENDING, CommunicationStatus.RINGING, CommunicationStatus.ACTIVE] },
      },
    });
    if (existing) {
      return this.toScannerView(existing, input.channel);
    }

    const publicSessionId = `cms_${randomToken(12)}`;

    const session = await prisma.communicationSession.create({
      data: {
        publicSessionId,
        tagId: tag.id,
        ownerId: owner.id,
        scannerSessionId: scanner.id,
        channel: input.channel as Channel,
        status: CommunicationStatus.PENDING,
        reasonCode: input.reasonCode,
        provider: this.providerFor(input.channel),
        riskScore: scanner.riskScore,
        requiresOtp,
        expiresAt: TTL[input.channel](),
      },
    });

    await prisma.tagEvent.create({
      data: {
        tagId: tag.id,
        eventType: this.eventFor(input.channel),
        scannerSessionId: scanner.id,
        metadata: { communicationSessionId: session.id, reasonCode: input.reasonCode },
      },
    });

    await audit({
      action: "communication.start",
      resourceType: "communication_session",
      resourceId: session.id,
      ip: input.ip,
      metadata: { channel: input.channel, tagId: tag.id, riskScore: scanner.riskScore },
    });

    // Provider work is queued so a slow provider never blocks the scanner.
    await enqueueCommunicationJob({ communicationSessionId: session.id, channel: input.channel });

    log.info({ sessionId: session.id, channel: input.channel, tagId: tag.id }, "communication session created");
    return this.toScannerView(session, input.channel);
  },

  /**
   * The scanner's view of a session. Note what is absent: any phone number,
   * name, or provider identifier that could identify the owner.
   */
  toScannerView(session: {
    id: string;
    publicSessionId: string;
    channel: Channel;
    status: CommunicationStatus;
    relayReference: string | null;
    expiresAt: Date;
  }, channel: ChannelName) {
    return {
      sessionId: session.publicSessionId,
      channel,
      status: session.status,
      expiresAt: session.expiresAt,
      requiresOtp: channel === "VOICE" || channel === "VIDEO" ? false : undefined,
      // For voice the scanner dials the relay number, never the owner's number.
      relayNumber: channel === "VOICE" && session.status === CommunicationStatus.ACTIVE
        ? session.relayReference
        : undefined,
      pollAfterSeconds: 2,
    };
  },

  /**
   * Worker-side dispatch. All provider calls funnel through here so route
   * handlers never touch a provider SDK directly (spec 32.2).
   */
  async dispatch(communicationSessionId: string): Promise<void> {
    const session = await prisma.communicationSession.findUnique({
      where: { id: communicationSessionId },
      include: { tag: { include: { owner: true, asset: true } }, scannerSession: true },
    });
    if (!session) throw notFound("Communication session not found");

    try {
      switch (session.channel) {
        case Channel.VOICE:
        case Channel.VIDEO:
          await this.dispatchVoice(session);
          break;
        case Channel.SMS:
          await this.dispatchSms(session);
          break;
        case Channel.WHATSAPP:
          await this.dispatchWhatsApp(session);
          break;
        case Channel.CHAT:
          await this.dispatchChat(session);
          break;
      }
    } catch (error) {
      log.error({ err: error, sessionId: session.id }, "dispatch failed");
      await prisma.communicationSession.update({
        where: { id: session.id },
        data: { status: CommunicationStatus.FAILED, endedAt: new Date() },
      });
    }
  },

  /**
   * Voice relay (spec 10.1). The provider receives a relay number and the
   * owner's own number; the scanner only ever learns the relay number.
   */
  async dispatchVoice(session: {
    id: string;
    tag: { id: string; ownerId: string; owner: { phoneEncrypted: string } };
    relayReference: string | null;
  }) {
    const { relayNumber, reference } = await voiceProvider.allocateRelay();
    const call = await voiceProvider.initiateCall({
      callerReference: `scanner_${session.id.slice(0, 8)}`,
      relayNumber,
      ownerReference: `owner_${session.id.slice(0, 8)}`,
      sessionId: session.id,
      maxDurationSeconds: env.MAX_CALL_DURATION_SECONDS,
      statusCallbackUrl: `${env.API_BASE_URL}/api/webhooks/voice/${session.id}`,
      // Recording stays off unless policy explicitly enables it (spec 10.4).
      record: env.CALL_RECORDING_ENABLED,
    });

    await prisma.$transaction([
      prisma.callSession.create({
        data: {
          communicationSessionId: session.id,
          relayNumberReference: reference,
          callerReference: `scanner_${session.id.slice(0, 8)}`,
          calleeReference: `owner_${session.id.slice(0, 8)}`,
          providerCallSid: call.providerCallId,
          status: "RINGING",
        },
      }),
      prisma.communicationSession.update({
        where: { id: session.id },
        data: {
          // The relay is a platform-owned virtual number that the scanner dials.
          // It identifies neither party; CallSession keeps the provider's own
          // internal reference for releasing the number back to the pool.
          relayReference: relayNumber,
          providerSessionId: call.providerCallId,
          status: CommunicationStatus.RINGING,
          startedAt: new Date(),
        },
      }),
      prisma.tagEvent.create({
        data: { tagId: session.tag.id, eventType: "CALL_STARTED", metadata: { sessionId: session.id } },
      }),
    ]);
  },

  async dispatchSms(session: { id: string; tag: { id: string; owner: { phoneEncrypted: string } }; reasonCode: string | null }) {
    const ownerPhone = decryptField(session.tag.owner.phoneEncrypted, "phone");
    const result = await smsProvider.send({
      to: ownerPhone,
      body: renderOwnerAlert("SMS", session.reasonCode, session.id),
      templateKey: "OWNER_CONTACT_ALERT",
      idempotencyKey: `sms:${session.id}`,
    });

    await prisma.communicationSession.update({
      where: { id: session.id },
      data: { status: CommunicationStatus.ACTIVE, providerSessionId: result.providerMessageId, startedAt: new Date() },
    });
  },

  async dispatchWhatsApp(session: { id: string; tag: { owner: { phoneEncrypted: string } }; reasonCode: string | null }) {
    const ownerPhone = decryptField(session.tag.owner.phoneEncrypted, "phone");
    const result = await whatsappProvider.send({
      to: ownerPhone,
      body: renderOwnerAlert("WhatsApp", session.reasonCode, session.id),
      mode: "NOTIFICATION",
      templateName: "owner_contact_alert",
      idempotencyKey: `wa:${session.id}`,
    });

    await prisma.communicationSession.update({
      where: { id: session.id },
      data: { status: CommunicationStatus.ACTIVE, providerSessionId: result.providerMessageId, startedAt: new Date() },
    });
  },

  /**
   * Secure web chat (spec 13). Both parties are pseudonymous: the scanner holds
   * a session token, the owner is authenticated, and neither sees the other's
   * contact details. Messages are encrypted at rest and expire with the session.
   */
  async dispatchChat(session: { id: string; tag: { id: string; ownerId: string }; scannerSessionId: string }) {
    await prisma.communicationSession.update({
      where: { id: session.id },
      data: { status: CommunicationStatus.ACTIVE, startedAt: new Date() },
    });
    await prisma.tagEvent.create({
      data: { tagId: session.tag.id, eventType: "MESSAGE_SENT", metadata: { sessionId: session.id } },
    });
  },

  /**
   * Emergency (spec 15). Only the minimum is surfaced: the owner is alerted
   * immediately and priority contacts are notified by the notification worker.
   * Medical and policy details are not included in the alert payload.
   */
  async raiseEmergency(input: { sessionToken: string; reasonCode: string; note?: string }) {
    const scanner = await scannerService.authorizeSession(input.sessionToken);

    const alert = await prisma.emergencyAlert.create({
      data: {
        scannerSessionId: scanner.id,
        ownerId: scanner.tag.ownerId,
        reasonCode: input.reasonCode,
        note: input.note?.slice(0, 280),
        riskScore: scanner.riskScore,
      },
    });

    await prisma.tagEvent.create({
      data: {
        tagId: scanner.tagId,
        eventType: "EMERGENCY_TRIGGERED",
        scannerSessionId: scanner.id,
        metadata: { alertId: alert.id },
      },
    });

    await audit({
      action: "emergency.raise",
      resourceType: "emergency_alert",
      resourceId: alert.id,
      metadata: { tagId: scanner.tagId, riskScore: scanner.riskScore },
    });

    log.warn({ alertId: alert.id, tagId: scanner.tagId }, "emergency alert raised");
    return { alertId: alert.id, status: alert.status, ownerNotified: true, createdAt: alert.createdAt };
  },

  /** Owner's view of an incoming contact. Includes the owner's own identifiers. */
  async listForOwner(ownerId: string, limit = 50) {
    const sessions = await prisma.communicationSession.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        tag: { select: { publicTagId: true, tagType: true, label: true, asset: { select: { displayName: true, assetType: true } } } },
        call: { select: { status: true, durationSeconds: true } },
        _count: { select: { messages: true } },
      },
    });

    return sessions.map((s) => ({
      id: s.publicSessionId,
      channel: s.channel,
      status: s.status,
      reasonCode: s.reasonCode,
      tag: s.tag,
      messageCount: s._count.messages,
      callStatus: s.call?.status ?? null,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      createdAt: s.createdAt,
    }));
  },

  /** Owner's reply over secure chat. */
  async reply(input: { ownerId: string; communicationSessionId: string; body: string }) {
    const session = await prisma.communicationSession.findUnique({
      where: { publicSessionId: input.communicationSessionId },
    });
    if (!session) throw notFound("Conversation not found");
    if (session.ownerId !== input.ownerId) throw forbidden("This conversation is not yours");
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppError("CONFLICT", "This conversation has expired");
    }

    const body = input.body.trim();
    if (body.length === 0) throw badRequest("Message cannot be empty");
    if (body.length > 2000) throw badRequest("Message is too long");

    const message = await prisma.message.create({
      data: {
        communicationSessionId: session.id,
        senderType: "OWNER",
        senderReference: `owner:${input.ownerId}`,
        recipientType: "SCANNER",
        recipientReference: `scanner_session:${session.scannerSessionId}`,
        channel: session.channel,
        bodyCiphertext: encryptField(body, "message"),
        status: "SENT",
        expiresAt: session.expiresAt,
      },
    });

    await prisma.communicationSession.update({
      where: { id: session.id },
      data: { status: CommunicationStatus.ACTIVE },
    });

    return { messageId: message.id, createdAt: message.createdAt };
  },

  /** Scanner's message over secure chat. */
  async sendFromScanner(input: { sessionToken: string; communicationSessionId: string; body: string }) {
    const scanner = await scannerService.authorizeSession(input.sessionToken);
    const session = await prisma.communicationSession.findUnique({
      where: { publicSessionId: input.communicationSessionId },
    });
    if (!session) throw notFound("Conversation not found");
    if (session.scannerSessionId !== scanner.id) throw forbidden("This conversation is not yours");
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppError("CONFLICT", "This conversation has expired");
    }

    const body = input.body.trim();
    if (body.length === 0) throw badRequest("Message cannot be empty");
    if (body.length > 2000) throw badRequest("Message is too long");

    const message = await prisma.message.create({
      data: {
        communicationSessionId: session.id,
        senderType: "SCANNER",
        senderReference: `scanner_session:${scanner.id}`,
        recipientType: "OWNER",
        recipientReference: `owner:${scanner.tag.ownerId}`,
        channel: session.channel,
        bodyCiphertext: encryptField(body, "message"),
        status: "SENT",
        expiresAt: session.expiresAt,
      },
    });

    return { messageId: message.id, createdAt: message.createdAt };
  },

  /** Conversation transcript, decrypted for the authorised party only. */
  async messages(input: { communicationSessionId: string; actor: "OWNER" | "SCANNER"; ownerId?: string; sessionToken?: string }) {
    let sessionId: string;

    if (input.actor === "OWNER") {
      const session = await prisma.communicationSession.findUnique({
        where: { publicSessionId: input.communicationSessionId },
      });
      if (!session) throw notFound("Conversation not found");
      if (session.ownerId !== input.ownerId) throw forbidden("This conversation is not yours");
      sessionId = session.id;
    } else {
      const scanner = await scannerService.authorizeSession(input.sessionToken!);
      const session = await prisma.communicationSession.findUnique({
        where: { publicSessionId: input.communicationSessionId },
      });
      if (!session) throw notFound("Conversation not found");
      if (session.scannerSessionId !== scanner.id) throw forbidden("This conversation is not yours");
      sessionId = session.id;
    }

    const messages = await prisma.message.findMany({
      where: { communicationSessionId: sessionId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });

    return messages.map((m) => ({
      id: m.id,
      senderType: m.senderType,
      body: decryptField(m.bodyCiphertext, "message"),
      status: m.status,
      createdAt: m.createdAt,
      expiresAt: m.expiresAt,
    }));
  },

  async scannerStatus(sessionToken: string) {
    const scanner = await scannerService.authorizeSession(sessionToken);
    const sessions = await prisma.communicationSession.findMany({
      where: { scannerSessionId: scanner.id },
      orderBy: { createdAt: "desc" },
    });
    return {
      scannerSessionId: scanner.publicSessionId,
      riskState: scanner.riskState,
      phoneVerified: scanner.phoneVerified,
      reasonCode: scanner.reasonCode,
      expiresAt: scanner.expiresAt,
      communications: sessions.map((s) => this.toScannerView(s, s.channel as ChannelName)),
    };
  },

  async endScannerSession(sessionToken: string) {
    const scanner = await scannerService.authorizeSession(sessionToken);
    await prisma.$transaction([
      prisma.scannerSession.update({ where: { id: scanner.id }, data: { status: "ENDED" } }),
      prisma.communicationSession.updateMany({
        where: { scannerSessionId: scanner.id, status: { in: [CommunicationStatus.CREATED, CommunicationStatus.PENDING] } },
        data: { status: CommunicationStatus.CANCELLED, endedAt: new Date() },
      }),
    ]);
  },

  providerFor(channel: ChannelName): string {
    switch (channel) {
      case "VOICE":
      case "VIDEO":
        return voiceProvider.name;
      case "SMS":
        return smsProvider.name;
      case "WHATSAPP":
        return whatsappProvider.name;
      case "CHAT":
        return "internal";
    }
  },

  eventFor(channel: ChannelName) {
    switch (channel) {
      case "VOICE":
      case "VIDEO":
        return "CALL_STARTED" as const;
      case "SMS":
        return "SMS_SENT" as const;
      case "WHATSAPP":
        return "WHATSAPP_SENT" as const;
      case "CHAT":
        return "MESSAGE_SENT" as const;
    }
  },
};

/**
 * Owner-facing alert copy. Kept as a versioned template so provider-side
 * template registration (and DLT approval in India) can track changes.
 */
const renderOwnerAlert = (channel: string, reasonCode: string | null, sessionId: string): string => {
  const reason = reasonCode ? reasonCode.replace(/_/g, " ").toLowerCase() : "unspecified";
  return [
    `${channel} alert`,
    "",
    `Someone contacted you about your tag. Reason: ${reason}.`,
    "",
    `Open secure communication: ${env.WEB_BASE_URL}/conversation/${sha256(sessionId).slice(0, 16)}`,
  ].join("\n");
};
