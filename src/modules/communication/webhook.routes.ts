import { Router, raw, type RequestHandler } from "express";
import { z } from "zod";
import { CommunicationStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { childLogger } from "../../common/logger";
import { notFound } from "../../common/errors";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { encryptField, lookupHmac } from "../../common/utils/crypto";
import { smsProvider, voiceProvider, whatsappProvider } from "../../providers";

const log = childLogger("webhooks");

/**
 * Webhook handling rules (spec 32.2):
 *  1. the raw body is required so the signature can be verified before parsing,
 *  2. every request is signature-checked before it is interpreted,
 *  3. every event is idempotent, keyed on the provider's own event id,
 *  4. malformed or unknown events are acknowledged rather than retried forever.
 */

/**
 * Claims an event id in a durable ledger. Returns false when the event has
 * already been processed, which is how provider retries are made safe.
 */
const claimEvent = async (handler: string, providerEventId: string): Promise<boolean> => {
  try {
    await prisma.webhookEvent.create({ data: { handler, providerEventId } });
    return true;
  } catch (error) {
    // P2002 = unique violation, i.e. this event was already handled.
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
};

/** Captures the raw body for signature verification. */
const rawBody: RequestHandler = (req, _res, next) => {
  raw({ type: ["application/json", "application/x-www-form-urlencoded"], limit: "1mb" })(req, _res, next);
};

const signatureOf = (req: { header(name: string): string | undefined }): string | undefined =>
  req.header("x-sampark-signature") ?? req.header("x-provider-signature");

export const webhookRouter = Router();

// ---------------------------------------------------------------------------
// Voice / call status
// ---------------------------------------------------------------------------

const voiceEventSchema = z.object({
  eventId: z.string().min(4).max(200),
  callSid: z.string().min(2).max(120),
  status: z.string().max(40).optional(),
  duration: z.number().int().min(0).max(86_400).optional(),
  reason: z.string().max(120).optional(),
});

const TERMINAL_CALL_STATES = ["completed", "busy", "failed", "no-answer", "canceled"];

webhookRouter.post(
  "/voice/:sessionId",
  rawBody,
  asyncHandler(async (req, res) => {
    if (!voiceProvider.verifyWebhookSignature(req.body as Buffer, signatureOf(req))) {
      log.warn({ sessionId: req.params.sessionId }, "rejected voice webhook: invalid signature");
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Invalid signature" } });
    }

    const parsed = voiceEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Malformed payload" } });
    }
    const event = parsed.data;

    if (!(await claimEvent("voice", event.eventId))) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    const session = await prisma.communicationSession.findUnique({
      where: { id: req.params.sessionId },
      include: { call: true },
    });
    if (!session) throw notFound("Session not found");

    const status = (event.status ?? "").toLowerCase();
    const terminal = TERMINAL_CALL_STATES.includes(status);
    const connected = status === "in-progress" || status === "answered";

    await prisma.$transaction([
      prisma.callSession.update({
        where: { communicationSessionId: session.id },
        data: {
          status: (status || "completed").toUpperCase().replace(/-/g, "_"),
          durationSeconds: event.duration ?? session.call?.durationSeconds ?? 0,
          hangupReason: event.reason ?? null,
          ...(terminal ? { endedAt: new Date() } : {}),
        },
      }),
      prisma.communicationSession.update({
        where: { id: session.id },
        data: {
          status: terminal ? CommunicationStatus.COMPLETED : connected ? CommunicationStatus.ACTIVE : CommunicationStatus.RINGING,
          ...(connected ? { connectedAt: new Date() } : {}),
          ...(terminal ? { endedAt: new Date() } : {}),
        },
      }),
      ...(terminal
        ? [
            prisma.tagEvent.create({
              data: {
                tagId: session.tagId,
                eventType: "CALL_ENDED" as const,
                metadata: { sessionId: session.id, duration: event.duration ?? 0, reason: event.reason ?? null },
              },
            }),
          ]
        : []),
    ]);

    if (terminal && session.call) {
      // Release the relay so the pool is not held for the duration cap.
      await voiceProvider.releaseRelay(session.call.relayNumberReference);
    }

    return res.status(200).json({ received: true });
  }),
);

// ---------------------------------------------------------------------------
// SMS delivery status
// ---------------------------------------------------------------------------

const smsEventSchema = z.object({
  eventId: z.string().min(4).max(200),
  messageSid: z.string().min(2).max(120),
  status: z.string().max(40).optional(),
});

webhookRouter.post(
  "/sms/:sessionId",
  rawBody,
  asyncHandler(async (req, res) => {
    if (!smsProvider.verifyWebhookSignature(req.body as Buffer, signatureOf(req))) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Invalid signature" } });
    }

    const parsed = smsEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Malformed payload" } });
    }

    if (!(await claimEvent("sms", parsed.data.eventId))) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    const session = await prisma.communicationSession.findUnique({ where: { id: req.params.sessionId } });
    if (!session) throw notFound("Session not found");

    await prisma.communicationSession.update({
      where: { id: session.id },
      data: { status: mapSmsStatus(parsed.data.status) },
    });
    return res.status(200).json({ received: true });
  }),
);

// ---------------------------------------------------------------------------
// WhatsApp inbound
// ---------------------------------------------------------------------------

const whatsappInboundSchema = z.object({
  eventId: z.string().min(4).max(200),
  messageSid: z.string().min(2).max(200),
  from: z.string().min(6).max(20),
  body: z.string().max(4000).optional(),
  type: z.string().max(40).optional(),
});

/**
 * WhatsApp Mode B (spec 12.1). An owner replying over WhatsApp becomes a secure
 * chat message, so the scanner keeps seeing a pseudonymous conversation and
 * never learns the owner's WhatsApp identity.
 */
webhookRouter.post(
  "/whatsapp",
  rawBody,
  asyncHandler(async (req, res) => {
    if (!whatsappProvider.verifyWebhookSignature(req.body as Buffer, signatureOf(req))) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Invalid signature" } });
    }

    const parsed = whatsappInboundSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Malformed payload" } });
    }
    const event = parsed.data;

    if (!(await claimEvent("whatsapp", event.eventId))) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    if (event.type === "status") {
      return res.status(200).json({ received: true });
    }

    const owner = await prisma.user.findUnique({
      where: { phoneLookupHmac: lookupHmac(event.from, "phone") },
      select: { id: true },
    });
    if (!owner) {
      log.warn({ fromTail: event.from.slice(-4) }, "whatsapp inbound from unknown sender ignored");
      return res.status(200).json({ received: true, ignored: "unknown_sender" });
    }

    const session = await prisma.communicationSession.findFirst({
      where: {
        ownerId: owner.id,
        channel: "WHATSAPP",
        status: { in: [CommunicationStatus.CREATED, CommunicationStatus.PENDING, CommunicationStatus.ACTIVE] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!session) {
      return res.status(200).json({ received: true, ignored: "no_open_conversation" });
    }

    if (event.body) {
      await prisma.message.create({
        data: {
          communicationSessionId: session.id,
          senderType: "OWNER",
          senderReference: `whatsapp:${owner.id}`,
          recipientType: "SCANNER",
          recipientReference: `scanner_session:${session.scannerSessionId}`,
          channel: "WHATSAPP",
          bodyCiphertext: encryptField(event.body, "message"),
          status: "SENT",
          providerMessageId: event.messageSid,
          expiresAt: session.expiresAt,
        },
      });
    }

    await whatsappProvider.markRead(event.messageSid);
    return res.status(200).json({ received: true });
  }),
);

const mapSmsStatus = (status?: string): CommunicationStatus => {
  switch ((status ?? "").toLowerCase()) {
    case "delivered":
      return CommunicationStatus.COMPLETED;
    case "failed":
    case "undelivered":
      return CommunicationStatus.FAILED;
    default:
      return CommunicationStatus.ACTIVE;
  }
};
