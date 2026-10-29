"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scannerService = void 0;
const prisma_1 = require("../../db/prisma");
const config_1 = require("../../config");
const errors_1 = require("../../common/errors");
const crypto_1 = require("../../common/utils/crypto");
const time_1 = require("../../common/utils/time");
const logger_1 = require("../../common/logger");
const tag_service_1 = require("../tags/tag.service");
const audit_service_1 = require("../audit/audit.service");
const otp_service_1 = require("../auth/otp.service");
const log = (0, logger_1.childLogger)("scanner");
/**
 * Abuse controls (spec 7.3, 10.4). Configurable per tag class in production;
 * these defaults are intentionally conservative.
 */
const LIMITS = {
    sessionsPerHourPerTag: 20,
    sessionsPerHourPerIp: 30,
    actionsPerSession: 8,
    sessionTtlMinutes: 60,
    highRiskChannels: ["VOICE", "VIDEO"],
};
exports.scannerService = {
    /**
     * Public entry point: a visitor opens /t/<token> in a mobile browser with no
     * account. Returns the masked display projection and the available channels.
     */
    async resolveTag(input) {
        const view = await tag_service_1.tagService.resolveForScanner(input.publicToken);
        const session = await this.createSession({ publicToken: input.publicToken, ip: input.ip, userAgent: input.userAgent });
        return { view, scannerSession: session };
    },
    async createSession(input) {
        const tag = await prisma_1.prisma.tag.findUnique({ where: { publicTokenHash: (0, crypto_1.sha256)(input.publicToken) } });
        if (!tag)
            throw (0, errors_1.notFound)("This code is not valid");
        await this.assertNotRateLimited(tag.id, input.ip);
        const publicSessionId = `scn_${(0, crypto_1.randomToken)(12)}`;
        const sessionToken = (0, crypto_1.randomToken)(32);
        const risk = this.scoreRisk({ ip: input.ip, userAgent: input.userAgent });
        const session = await prisma_1.prisma.scannerSession.create({
            data: {
                publicSessionId,
                sessionTokenHash: (0, crypto_1.sha256)(sessionToken),
                tagId: tag.id,
                reasonCode: input.reasonCode,
                ipHash: input.ip ? (0, crypto_1.sha256)(input.ip) : null,
                // Hashed like the IP: a raw user agent is a durable fingerprint, and
                // nothing downstream needs it in a readable form.
                userAgent: input.userAgent ? (0, crypto_1.sha256)(input.userAgent.slice(0, 256)) : null,
                riskScore: risk.score,
                riskState: risk.state,
                expiresAt: (0, time_1.addMinutes)(LIMITS.sessionTtlMinutes),
            },
        });
        await prisma_1.prisma.tagEvent.create({
            data: { tagId: tag.id, eventType: "TAG_SCAN", scannerSessionId: session.id, ipHash: input.ip ? (0, crypto_1.sha256)(input.ip) : null },
        });
        log.info({ sessionId: session.id, tagId: tag.id, riskState: risk.state }, "scanner session created");
        return { id: publicSessionId, sessionToken, expiresAt: session.expiresAt };
    },
    /**
     * Resolves and authorizes a scanner session. Every privacy-gateway action goes
     * through here, so ownership, expiry and risk are re-checked each time.
     */
    async authorizeSession(sessionToken) {
        const session = await prisma_1.prisma.scannerSession.findUnique({
            where: { sessionTokenHash: (0, crypto_1.sha256)(sessionToken) },
            include: { tag: { include: { owner: true, asset: { include: { vehicle: true } } } } },
        });
        if (!session)
            throw (0, errors_1.forbidden)("Invalid or expired session");
        if (session.status !== "ACTIVE")
            throw (0, errors_1.forbidden)("This session is no longer active");
        if (session.expiresAt.getTime() <= Date.now()) {
            await prisma_1.prisma.scannerSession.update({ where: { id: session.id }, data: { status: "EXPIRED" } });
            throw (0, errors_1.forbidden)("This session has expired. Please scan the code again.");
        }
        if (session.tag.status !== "ACTIVE") {
            throw new errors_1.AppError("TAG_INACTIVE", "This tag is no longer active");
        }
        if (session.tag.owner.status !== "ACTIVE") {
            throw new errors_1.AppError("TAG_INACTIVE", "The owner is not reachable right now");
        }
        return session;
    },
    async setReason(sessionToken, reasonCode) {
        const session = await this.authorizeSession(sessionToken);
        const assetType = session.tag.asset?.assetType ?? null;
        if (!tag_service_1.tagService.reasonIsAllowed(reasonCode, assetType)) {
            throw new errors_1.AppError("BAD_REQUEST", "That reason is not available for this tag");
        }
        await prisma_1.prisma.scannerSession.update({ where: { id: session.id }, data: { reasonCode } });
        return { reasonCode };
    },
    /**
     * Optional scanner verification. Low-risk actions proceed without it; voice and
     * video require a verified phone so a relay number is not handed to an
     * anonymous caller without friction.
     */
    async verifyScannerPhone(input) {
        const session = await this.authorizeSession(input.sessionToken);
        const phone = (0, crypto_1.normalizePhone)(input.phone);
        await (0, otp_service_1.verifyOtp)({ phone, code: input.code, purpose: "SCANNER_VERIFY" });
        const updated = await prisma_1.prisma.scannerSession.update({
            where: { id: session.id },
            data: { phoneLookupHmac: (0, crypto_1.lookupHmac)(phone, "phone"), phoneVerified: true },
        });
        return { verified: updated.phoneVerified };
    },
    /**
     * Per-tag and per-IP budgets. Implemented against the database so limits hold
     * across instances, not just within one process.
     */
    async assertNotRateLimited(tagId, ip) {
        const since = new Date(Date.now() - 60 * 60 * 1000);
        const perTag = await prisma_1.prisma.scannerSession.count({ where: { tagId, createdAt: { gt: since } } });
        if (perTag >= LIMITS.sessionsPerHourPerTag) {
            await this.flag(tagId, "RATE_LIMITED", { scope: "tag", ip });
            throw (0, errors_1.rateLimited)("Too many contact attempts for this tag. Please try again later.");
        }
        if (ip) {
            const ipHash = (0, crypto_1.sha256)(ip);
            const perIp = await prisma_1.prisma.scannerSession.count({ where: { ipHash, createdAt: { gt: since } } });
            if (perIp >= LIMITS.sessionsPerHourPerIp) {
                await this.flag(tagId, "RATE_LIMITED", { scope: "ip", ip });
                throw (0, errors_1.rateLimited)("Too many attempts from this network. Please try again later.");
            }
        }
    },
    /** Caps how many communications a single scanner session can create. */
    async assertSessionActionBudget(sessionId) {
        const count = await prisma_1.prisma.communicationSession.count({ where: { scannerSessionId: sessionId } });
        if (count >= LIMITS.actionsPerSession) {
            throw (0, errors_1.rateLimited)("You have reached the limit of contact attempts for this scan. Please try again later.");
        }
    },
    /**
     * Heuristic risk scoring (spec 7.3). A production deployment should add
     * device fingerprinting, IP reputation and CAPTCHA escalation on top.
     */
    scoreRisk(input) {
        let score = 0;
        if (!input.userAgent)
            score += 20;
        else if (/curl|wget|python|postman|scrapy|bot|headless/i.test(input.userAgent))
            score += 60;
        if (!input.ip)
            score += 10;
        if (input.phoneVerified)
            score -= 40;
        const bounded = Math.max(0, Math.min(100, score));
        return { score: bounded, state: bounded >= 60 ? "HIGH" : bounded >= 30 ? "MEDIUM" : "LOW" };
    },
    /**
     * High-risk sessions must verify before voice/video relay allocation, and are
     * surfaced to the fraud queue.
     */
    requiresOtp(session) {
        if (session.phoneVerified)
            return false;
        return session.riskState === "HIGH" || session.riskScore >= 60;
    },
    async flag(tagId, reason, meta) {
        try {
            await prisma_1.prisma.abuseReport.create({
                data: { reporterType: "SYSTEM", reporterRef: "abuse-engine", tagId, reason, riskScore: 0, details: JSON.stringify(meta).slice(0, 500) },
            });
            await (0, audit_service_1.audit)({ action: `abuse.${reason}`, resourceType: "tag", resourceId: tagId, outcome: "DENIED", metadata: meta });
        }
        catch (error) {
            log.error({ err: error, tagId, reason }, "failed to record abuse flag");
        }
    },
    chatTtl() {
        return (0, time_1.addHours)(config_1.env.DEFAULT_CHAT_TTL_HOURS);
    },
};
//# sourceMappingURL=scanner.service.js.map