"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const prisma_1 = require("../../db/prisma");
const logger_1 = require("../../common/logger");
const errors_1 = require("../../common/errors");
const asyncHandler_1 = require("../../common/utils/asyncHandler");
const crypto_1 = require("../../common/utils/crypto");
const providers_1 = require("../../providers");
const log = (0, logger_1.childLogger)("webhooks");
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
const claimEvent = async (handler, providerEventId) => {
    try {
        await prisma_1.prisma.webhookEvent.create({ data: { handler, providerEventId } });
        return true;
    }
    catch (error) {
        // P2002 = unique violation, i.e. this event was already handled.
        if (error.code === "P2002")
            return false;
        throw error;
    }
};
/** Captures the raw body for signature verification. */
const rawBody = (req, _res, next) => {
    (0, express_1.raw)({ type: ["application/json", "application/x-www-form-urlencoded"], limit: "1mb" })(req, _res, next);
};
const signatureOf = (req) => req.header("x-sampark-signature") ?? req.header("x-provider-signature");
exports.webhookRouter = (0, express_1.Router)();
// ---------------------------------------------------------------------------
// Voice / call status
// ---------------------------------------------------------------------------
const voiceEventSchema = zod_1.z.object({
    eventId: zod_1.z.string().min(4).max(200),
    callSid: zod_1.z.string().min(2).max(120),
    status: zod_1.z.string().max(40).optional(),
    duration: zod_1.z.number().int().min(0).max(86_400).optional(),
    reason: zod_1.z.string().max(120).optional(),
});
const TERMINAL_CALL_STATES = ["completed", "busy", "failed", "no-answer", "canceled"];
exports.webhookRouter.post("/voice/:sessionId", rawBody, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!providers_1.voiceProvider.verifyWebhookSignature(req.body, signatureOf(req))) {
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
    const session = await prisma_1.prisma.communicationSession.findUnique({
        where: { id: req.params.sessionId },
        include: { call: true },
    });
    if (!session)
        throw (0, errors_1.notFound)("Session not found");
    const status = (event.status ?? "").toLowerCase();
    const terminal = TERMINAL_CALL_STATES.includes(status);
    const connected = status === "in-progress" || status === "answered";
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.callSession.update({
            where: { communicationSessionId: session.id },
            data: {
                status: (status || "completed").toUpperCase().replace(/-/g, "_"),
                durationSeconds: event.duration ?? session.call?.durationSeconds ?? 0,
                hangupReason: event.reason ?? null,
                ...(terminal ? { endedAt: new Date() } : {}),
            },
        }),
        prisma_1.prisma.communicationSession.update({
            where: { id: session.id },
            data: {
                status: terminal ? client_1.CommunicationStatus.COMPLETED : connected ? client_1.CommunicationStatus.ACTIVE : client_1.CommunicationStatus.RINGING,
                ...(connected ? { connectedAt: new Date() } : {}),
                ...(terminal ? { endedAt: new Date() } : {}),
            },
        }),
        ...(terminal
            ? [
                prisma_1.prisma.tagEvent.create({
                    data: {
                        tagId: session.tagId,
                        eventType: "CALL_ENDED",
                        metadata: { sessionId: session.id, duration: event.duration ?? 0, reason: event.reason ?? null },
                    },
                }),
            ]
            : []),
    ]);
    if (terminal && session.call) {
        // Release the relay so the pool is not held for the duration cap.
        await providers_1.voiceProvider.releaseRelay(session.call.relayNumberReference);
    }
    return res.status(200).json({ received: true });
}));
// ---------------------------------------------------------------------------
// SMS delivery status
// ---------------------------------------------------------------------------
const smsEventSchema = zod_1.z.object({
    eventId: zod_1.z.string().min(4).max(200),
    messageSid: zod_1.z.string().min(2).max(120),
    status: zod_1.z.string().max(40).optional(),
});
exports.webhookRouter.post("/sms/:sessionId", rawBody, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!providers_1.smsProvider.verifyWebhookSignature(req.body, signatureOf(req))) {
        return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Invalid signature" } });
    }
    const parsed = smsEventSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Malformed payload" } });
    }
    if (!(await claimEvent("sms", parsed.data.eventId))) {
        return res.status(200).json({ received: true, duplicate: true });
    }
    const session = await prisma_1.prisma.communicationSession.findUnique({ where: { id: req.params.sessionId } });
    if (!session)
        throw (0, errors_1.notFound)("Session not found");
    await prisma_1.prisma.communicationSession.update({
        where: { id: session.id },
        data: { status: mapSmsStatus(parsed.data.status) },
    });
    return res.status(200).json({ received: true });
}));
// ---------------------------------------------------------------------------
// WhatsApp inbound
// ---------------------------------------------------------------------------
const whatsappInboundSchema = zod_1.z.object({
    eventId: zod_1.z.string().min(4).max(200),
    messageSid: zod_1.z.string().min(2).max(200),
    from: zod_1.z.string().min(6).max(20),
    body: zod_1.z.string().max(4000).optional(),
    type: zod_1.z.string().max(40).optional(),
});
/**
 * WhatsApp Mode B (spec 12.1). An owner replying over WhatsApp becomes a secure
 * chat message, so the scanner keeps seeing a pseudonymous conversation and
 * never learns the owner's WhatsApp identity.
 */
exports.webhookRouter.post("/whatsapp", rawBody, (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!providers_1.whatsappProvider.verifyWebhookSignature(req.body, signatureOf(req))) {
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
    const owner = await prisma_1.prisma.user.findUnique({
        where: { phoneLookupHmac: (0, crypto_1.lookupHmac)(event.from, "phone") },
        select: { id: true },
    });
    if (!owner) {
        log.warn({ fromTail: event.from.slice(-4) }, "whatsapp inbound from unknown sender ignored");
        return res.status(200).json({ received: true, ignored: "unknown_sender" });
    }
    const session = await prisma_1.prisma.communicationSession.findFirst({
        where: {
            ownerId: owner.id,
            channel: "WHATSAPP",
            status: { in: [client_1.CommunicationStatus.CREATED, client_1.CommunicationStatus.PENDING, client_1.CommunicationStatus.ACTIVE] },
        },
        orderBy: { createdAt: "desc" },
    });
    if (!session) {
        return res.status(200).json({ received: true, ignored: "no_open_conversation" });
    }
    if (event.body) {
        await prisma_1.prisma.message.create({
            data: {
                communicationSessionId: session.id,
                senderType: "OWNER",
                senderReference: `whatsapp:${owner.id}`,
                recipientType: "SCANNER",
                recipientReference: `scanner_session:${session.scannerSessionId}`,
                channel: "WHATSAPP",
                bodyCiphertext: (0, crypto_1.encryptField)(event.body, "message"),
                status: "SENT",
                providerMessageId: event.messageSid,
                expiresAt: session.expiresAt,
            },
        });
    }
    await providers_1.whatsappProvider.markRead(event.messageSid);
    return res.status(200).json({ received: true });
}));
const mapSmsStatus = (status) => {
    switch ((status ?? "").toLowerCase()) {
        case "delivered":
            return client_1.CommunicationStatus.COMPLETED;
        case "failed":
        case "undelivered":
            return client_1.CommunicationStatus.FAILED;
        default:
            return client_1.CommunicationStatus.ACTIVE;
    }
};
//# sourceMappingURL=webhook.routes.js.map