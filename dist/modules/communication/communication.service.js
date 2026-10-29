"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.communicationService = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = require("../../db/prisma");
const config_1 = require("../../config");
const errors_1 = require("../../common/errors");
const crypto_1 = require("../../common/utils/crypto");
const time_1 = require("../../common/utils/time");
const logger_1 = require("../../common/logger");
const providers_1 = require("../../providers");
const scanner_service_1 = require("../scanner/scanner.service");
const tag_service_1 = require("../tags/tag.service");
const audit_service_1 = require("../audit/audit.service");
const queues_1 = require("../../workers/queues");
const log = (0, logger_1.childLogger)("communication");
/** Session lifetimes per channel (spec 10.2, 13). */
const TTL = {
    VOICE: () => (0, time_1.addMinutes)(Math.max(5, Math.ceil(config_1.env.MAX_CALL_DURATION_SECONDS / 60))),
    VIDEO: () => (0, time_1.addMinutes)(15),
    SMS: () => (0, time_1.addMinutes)(30),
    WHATSAPP: () => (0, time_1.addHours)(24),
    CHAT: () => (0, time_1.addHours)(config_1.env.DEFAULT_CHAT_TTL_HOURS),
};
exports.communicationService = {
    /**
     * The privacy gateway's single write path for scanner-initiated contact.
     *
     * Order matters: validate the session, enforce the owner channel policy, apply
     * abuse controls, only then create a session and dispatch. Real numbers are
     * never returned to the scanner.
     */
    async startFromScanner(input) {
        const scanner = await scanner_service_1.scannerService.authorizeSession(input.sessionToken);
        await scanner_service_1.scannerService.assertSessionActionBudget(scanner.id);
        const tag = scanner.tag;
        const owner = tag.owner;
        if (!tag_service_1.tagService.reasonIsAllowed(input.reasonCode, tag.asset?.assetType ?? null)) {
            throw (0, errors_1.badRequest)("That reason is not available for this tag");
        }
        if (!owner.enabledChannels.includes(input.channel)) {
            throw new errors_1.AppError("CHANNEL_DISABLED", `The owner has not enabled ${input.channel.toLowerCase()} contact`);
        }
        if (input.channel === "VIDEO" && !owner.allowVideoCalls) {
            throw new errors_1.AppError("CHANNEL_DISABLED", "The owner has not enabled video calls");
        }
        if (input.channel === "VOICE" && !owner.allowUnknownCallers) {
            throw new errors_1.AppError("CHANNEL_DISABLED", "The owner is not accepting calls right now");
        }
        // High-risk sessions must verify a phone before we allocate a relay number.
        const requiresOtp = scanner_service_1.scannerService.requiresOtp(scanner);
        if (requiresOtp && (input.channel === "VOICE" || input.channel === "VIDEO")) {
            throw new errors_1.AppError("REAUTH_REQUIRED", "Please verify your phone number before making a call");
        }
        // One live session per channel per scanner session.
        const existing = await prisma_1.prisma.communicationSession.findFirst({
            where: {
                scannerSessionId: scanner.id,
                channel: input.channel,
                status: { in: [client_1.CommunicationStatus.CREATED, client_1.CommunicationStatus.PENDING, client_1.CommunicationStatus.RINGING, client_1.CommunicationStatus.ACTIVE] },
            },
        });
        if (existing) {
            return this.toScannerView(existing, input.channel);
        }
        const publicSessionId = `cms_${(0, crypto_1.randomToken)(12)}`;
        const session = await prisma_1.prisma.communicationSession.create({
            data: {
                publicSessionId,
                tagId: tag.id,
                ownerId: owner.id,
                scannerSessionId: scanner.id,
                channel: input.channel,
                status: client_1.CommunicationStatus.PENDING,
                reasonCode: input.reasonCode,
                provider: this.providerFor(input.channel),
                riskScore: scanner.riskScore,
                requiresOtp,
                expiresAt: TTL[input.channel](),
            },
        });
        await prisma_1.prisma.tagEvent.create({
            data: {
                tagId: tag.id,
                eventType: this.eventFor(input.channel),
                scannerSessionId: scanner.id,
                metadata: { communicationSessionId: session.id, reasonCode: input.reasonCode },
            },
        });
        await (0, audit_service_1.audit)({
            action: "communication.start",
            resourceType: "communication_session",
            resourceId: session.id,
            ip: input.ip,
            metadata: { channel: input.channel, tagId: tag.id, riskScore: scanner.riskScore },
        });
        // Provider work is queued so a slow provider never blocks the scanner.
        await (0, queues_1.enqueueCommunicationJob)({ communicationSessionId: session.id, channel: input.channel });
        log.info({ sessionId: session.id, channel: input.channel, tagId: tag.id }, "communication session created");
        return this.toScannerView(session, input.channel);
    },
    /**
     * The scanner's view of a session. Note what is absent: any phone number,
     * name, or provider identifier that could identify the owner.
     */
    toScannerView(session, channel) {
        return {
            sessionId: session.publicSessionId,
            channel,
            status: session.status,
            expiresAt: session.expiresAt,
            requiresOtp: channel === "VOICE" || channel === "VIDEO" ? false : undefined,
            // For voice the scanner dials the relay number, never the owner's number.
            relayNumber: channel === "VOICE" && session.status === client_1.CommunicationStatus.ACTIVE
                ? session.relayReference
                : undefined,
            pollAfterSeconds: 2,
        };
    },
    /**
     * Worker-side dispatch. All provider calls funnel through here so route
     * handlers never touch a provider SDK directly (spec 32.2).
     */
    async dispatch(communicationSessionId) {
        const session = await prisma_1.prisma.communicationSession.findUnique({
            where: { id: communicationSessionId },
            include: { tag: { include: { owner: true, asset: true } }, scannerSession: true },
        });
        if (!session)
            throw (0, errors_1.notFound)("Communication session not found");
        try {
            switch (session.channel) {
                case client_1.Channel.VOICE:
                case client_1.Channel.VIDEO:
                    await this.dispatchVoice(session);
                    break;
                case client_1.Channel.SMS:
                    await this.dispatchSms(session);
                    break;
                case client_1.Channel.WHATSAPP:
                    await this.dispatchWhatsApp(session);
                    break;
                case client_1.Channel.CHAT:
                    await this.dispatchChat(session);
                    break;
            }
        }
        catch (error) {
            log.error({ err: error, sessionId: session.id }, "dispatch failed");
            await prisma_1.prisma.communicationSession.update({
                where: { id: session.id },
                data: { status: client_1.CommunicationStatus.FAILED, endedAt: new Date() },
            });
        }
    },
    /**
     * Voice relay (spec 10.1). The provider receives a relay number and the
     * owner's own number; the scanner only ever learns the relay number.
     */
    async dispatchVoice(session) {
        const { relayNumber, reference } = await providers_1.voiceProvider.allocateRelay();
        const call = await providers_1.voiceProvider.initiateCall({
            callerReference: `scanner_${session.id.slice(0, 8)}`,
            relayNumber,
            ownerReference: `owner_${session.id.slice(0, 8)}`,
            sessionId: session.id,
            maxDurationSeconds: config_1.env.MAX_CALL_DURATION_SECONDS,
            statusCallbackUrl: `${config_1.env.API_BASE_URL}/api/webhooks/voice/${session.id}`,
            // Recording stays off unless policy explicitly enables it (spec 10.4).
            record: config_1.env.CALL_RECORDING_ENABLED,
        });
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.callSession.create({
                data: {
                    communicationSessionId: session.id,
                    relayNumberReference: reference,
                    callerReference: `scanner_${session.id.slice(0, 8)}`,
                    calleeReference: `owner_${session.id.slice(0, 8)}`,
                    providerCallSid: call.providerCallId,
                    status: "RINGING",
                },
            }),
            prisma_1.prisma.communicationSession.update({
                where: { id: session.id },
                data: {
                    // The relay is a platform-owned virtual number that the scanner dials.
                    // It identifies neither party; CallSession keeps the provider's own
                    // internal reference for releasing the number back to the pool.
                    relayReference: relayNumber,
                    providerSessionId: call.providerCallId,
                    status: client_1.CommunicationStatus.RINGING,
                    startedAt: new Date(),
                },
            }),
            prisma_1.prisma.tagEvent.create({
                data: { tagId: session.tag.id, eventType: "CALL_STARTED", metadata: { sessionId: session.id } },
            }),
        ]);
    },
    async dispatchSms(session) {
        const ownerPhone = (0, crypto_1.decryptField)(session.tag.owner.phoneEncrypted, "phone");
        const result = await providers_1.smsProvider.send({
            to: ownerPhone,
            body: renderOwnerAlert("SMS", session.reasonCode, session.id),
            templateKey: "OWNER_CONTACT_ALERT",
            idempotencyKey: `sms:${session.id}`,
        });
        await prisma_1.prisma.communicationSession.update({
            where: { id: session.id },
            data: { status: client_1.CommunicationStatus.ACTIVE, providerSessionId: result.providerMessageId, startedAt: new Date() },
        });
    },
    async dispatchWhatsApp(session) {
        const ownerPhone = (0, crypto_1.decryptField)(session.tag.owner.phoneEncrypted, "phone");
        const result = await providers_1.whatsappProvider.send({
            to: ownerPhone,
            body: renderOwnerAlert("WhatsApp", session.reasonCode, session.id),
            mode: "NOTIFICATION",
            templateName: "owner_contact_alert",
            idempotencyKey: `wa:${session.id}`,
        });
        await prisma_1.prisma.communicationSession.update({
            where: { id: session.id },
            data: { status: client_1.CommunicationStatus.ACTIVE, providerSessionId: result.providerMessageId, startedAt: new Date() },
        });
    },
    /**
     * Secure web chat (spec 13). Both parties are pseudonymous: the scanner holds
     * a session token, the owner is authenticated, and neither sees the other's
     * contact details. Messages are encrypted at rest and expire with the session.
     */
    async dispatchChat(session) {
        await prisma_1.prisma.communicationSession.update({
            where: { id: session.id },
            data: { status: client_1.CommunicationStatus.ACTIVE, startedAt: new Date() },
        });
        await prisma_1.prisma.tagEvent.create({
            data: { tagId: session.tag.id, eventType: "MESSAGE_SENT", metadata: { sessionId: session.id } },
        });
    },
    /**
     * Emergency (spec 15). Only the minimum is surfaced: the owner is alerted
     * immediately and priority contacts are notified by the notification worker.
     * Medical and policy details are not included in the alert payload.
     */
    async raiseEmergency(input) {
        const scanner = await scanner_service_1.scannerService.authorizeSession(input.sessionToken);
        const alert = await prisma_1.prisma.emergencyAlert.create({
            data: {
                scannerSessionId: scanner.id,
                ownerId: scanner.tag.ownerId,
                reasonCode: input.reasonCode,
                note: input.note?.slice(0, 280),
                riskScore: scanner.riskScore,
            },
        });
        await prisma_1.prisma.tagEvent.create({
            data: {
                tagId: scanner.tagId,
                eventType: "EMERGENCY_TRIGGERED",
                scannerSessionId: scanner.id,
                metadata: { alertId: alert.id },
            },
        });
        await (0, audit_service_1.audit)({
            action: "emergency.raise",
            resourceType: "emergency_alert",
            resourceId: alert.id,
            metadata: { tagId: scanner.tagId, riskScore: scanner.riskScore },
        });
        log.warn({ alertId: alert.id, tagId: scanner.tagId }, "emergency alert raised");
        return { alertId: alert.id, status: alert.status, ownerNotified: true, createdAt: alert.createdAt };
    },
    /** Owner's view of an incoming contact. Includes the owner's own identifiers. */
    async listForOwner(ownerId, limit = 50) {
        const sessions = await prisma_1.prisma.communicationSession.findMany({
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
    async reply(input) {
        const session = await prisma_1.prisma.communicationSession.findUnique({
            where: { publicSessionId: input.communicationSessionId },
        });
        if (!session)
            throw (0, errors_1.notFound)("Conversation not found");
        if (session.ownerId !== input.ownerId)
            throw (0, errors_1.forbidden)("This conversation is not yours");
        if (session.expiresAt.getTime() <= Date.now()) {
            throw new errors_1.AppError("CONFLICT", "This conversation has expired");
        }
        const body = input.body.trim();
        if (body.length === 0)
            throw (0, errors_1.badRequest)("Message cannot be empty");
        if (body.length > 2000)
            throw (0, errors_1.badRequest)("Message is too long");
        const message = await prisma_1.prisma.message.create({
            data: {
                communicationSessionId: session.id,
                senderType: "OWNER",
                senderReference: `owner:${input.ownerId}`,
                recipientType: "SCANNER",
                recipientReference: `scanner_session:${session.scannerSessionId}`,
                channel: session.channel,
                bodyCiphertext: (0, crypto_1.encryptField)(body, "message"),
                status: "SENT",
                expiresAt: session.expiresAt,
            },
        });
        await prisma_1.prisma.communicationSession.update({
            where: { id: session.id },
            data: { status: client_1.CommunicationStatus.ACTIVE },
        });
        return { messageId: message.id, createdAt: message.createdAt };
    },
    /** Scanner's message over secure chat. */
    async sendFromScanner(input) {
        const scanner = await scanner_service_1.scannerService.authorizeSession(input.sessionToken);
        const session = await prisma_1.prisma.communicationSession.findUnique({
            where: { publicSessionId: input.communicationSessionId },
        });
        if (!session)
            throw (0, errors_1.notFound)("Conversation not found");
        if (session.scannerSessionId !== scanner.id)
            throw (0, errors_1.forbidden)("This conversation is not yours");
        if (session.expiresAt.getTime() <= Date.now()) {
            throw new errors_1.AppError("CONFLICT", "This conversation has expired");
        }
        const body = input.body.trim();
        if (body.length === 0)
            throw (0, errors_1.badRequest)("Message cannot be empty");
        if (body.length > 2000)
            throw (0, errors_1.badRequest)("Message is too long");
        const message = await prisma_1.prisma.message.create({
            data: {
                communicationSessionId: session.id,
                senderType: "SCANNER",
                senderReference: `scanner_session:${scanner.id}`,
                recipientType: "OWNER",
                recipientReference: `owner:${scanner.tag.ownerId}`,
                channel: session.channel,
                bodyCiphertext: (0, crypto_1.encryptField)(body, "message"),
                status: "SENT",
                expiresAt: session.expiresAt,
            },
        });
        return { messageId: message.id, createdAt: message.createdAt };
    },
    /** Conversation transcript, decrypted for the authorised party only. */
    async messages(input) {
        let sessionId;
        if (input.actor === "OWNER") {
            const session = await prisma_1.prisma.communicationSession.findUnique({
                where: { publicSessionId: input.communicationSessionId },
            });
            if (!session)
                throw (0, errors_1.notFound)("Conversation not found");
            if (session.ownerId !== input.ownerId)
                throw (0, errors_1.forbidden)("This conversation is not yours");
            sessionId = session.id;
        }
        else {
            const scanner = await scanner_service_1.scannerService.authorizeSession(input.sessionToken);
            const session = await prisma_1.prisma.communicationSession.findUnique({
                where: { publicSessionId: input.communicationSessionId },
            });
            if (!session)
                throw (0, errors_1.notFound)("Conversation not found");
            if (session.scannerSessionId !== scanner.id)
                throw (0, errors_1.forbidden)("This conversation is not yours");
            sessionId = session.id;
        }
        const messages = await prisma_1.prisma.message.findMany({
            where: { communicationSessionId: sessionId },
            orderBy: { createdAt: "asc" },
            take: 200,
        });
        return messages.map((m) => ({
            id: m.id,
            senderType: m.senderType,
            body: (0, crypto_1.decryptField)(m.bodyCiphertext, "message"),
            status: m.status,
            createdAt: m.createdAt,
            expiresAt: m.expiresAt,
        }));
    },
    async scannerStatus(sessionToken) {
        const scanner = await scanner_service_1.scannerService.authorizeSession(sessionToken);
        const sessions = await prisma_1.prisma.communicationSession.findMany({
            where: { scannerSessionId: scanner.id },
            orderBy: { createdAt: "desc" },
        });
        return {
            scannerSessionId: scanner.publicSessionId,
            riskState: scanner.riskState,
            phoneVerified: scanner.phoneVerified,
            reasonCode: scanner.reasonCode,
            expiresAt: scanner.expiresAt,
            communications: sessions.map((s) => this.toScannerView(s, s.channel)),
        };
    },
    async endScannerSession(sessionToken) {
        const scanner = await scanner_service_1.scannerService.authorizeSession(sessionToken);
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.scannerSession.update({ where: { id: scanner.id }, data: { status: "ENDED" } }),
            prisma_1.prisma.communicationSession.updateMany({
                where: { scannerSessionId: scanner.id, status: { in: [client_1.CommunicationStatus.CREATED, client_1.CommunicationStatus.PENDING] } },
                data: { status: client_1.CommunicationStatus.CANCELLED, endedAt: new Date() },
            }),
        ]);
    },
    providerFor(channel) {
        switch (channel) {
            case "VOICE":
            case "VIDEO":
                return providers_1.voiceProvider.name;
            case "SMS":
                return providers_1.smsProvider.name;
            case "WHATSAPP":
                return providers_1.whatsappProvider.name;
            case "CHAT":
                return "internal";
        }
    },
    eventFor(channel) {
        switch (channel) {
            case "VOICE":
            case "VIDEO":
                return "CALL_STARTED";
            case "SMS":
                return "SMS_SENT";
            case "WHATSAPP":
                return "WHATSAPP_SENT";
            case "CHAT":
                return "MESSAGE_SENT";
        }
    },
};
/**
 * Owner-facing alert copy. Kept as a versioned template so provider-side
 * template registration (and DLT approval in India) can track changes.
 */
const renderOwnerAlert = (channel, reasonCode, sessionId) => {
    const reason = reasonCode ? reasonCode.replace(/_/g, " ").toLowerCase() : "unspecified";
    return [
        `${channel} alert`,
        "",
        `Someone contacted you about your tag. Reason: ${reason}.`,
        "",
        `Open secure communication: ${config_1.env.WEB_BASE_URL}/conversation/${(0, crypto_1.sha256)(sessionId).slice(0, 16)}`,
    ].join("\n");
};
//# sourceMappingURL=communication.service.js.map