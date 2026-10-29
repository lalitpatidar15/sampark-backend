import { prisma } from "../../db/prisma";
import { env } from "../../config";
import { AppError, forbidden, notFound, rateLimited } from "../../common/errors";
import { lookupHmac, normalizePhone, randomToken, sha256 } from "../../common/utils/crypto";
import { addHours, addMinutes } from "../../common/utils/time";
import { childLogger } from "../../common/logger";
import { tagService } from "../tags/tag.service";
import { audit } from "../audit/audit.service";
import { verifyOtp } from "../auth/otp.service";

const log = childLogger("scanner");

export interface PublicTagView {
  tag: { publicTagId: string; tagType: string; status: string };
  display: {
    assetType: string | null;
    displayName: string | null;
    make: string | null;
    model: string | null;
    color: string | null;
    registrationEnding: string | null;
  };
  channels: Record<string, boolean>;
  reasons: { code: string; label: string }[];
  owner: { displayName: string | null; businessHours: string | null };
}

/**
 * Abuse controls (spec 7.3, 10.4). Configurable per tag class in production;
 * these defaults are intentionally conservative.
 */
const LIMITS = {
  sessionsPerHourPerTag: 20,
  sessionsPerHourPerIp: 30,
  actionsPerSession: 8,
  sessionTtlMinutes: 60,
  highRiskChannels: ["VOICE", "VIDEO"] as const,
};

export const scannerService = {
  /**
   * Public entry point: a visitor opens /t/<token> in a mobile browser with no
   * account. Returns the masked display projection and the available channels.
   */
  async resolveTag(input: { publicToken: string; ip?: string; userAgent?: string }): Promise<{
    view: PublicTagView;
    scannerSession: { id: string; sessionToken: string; expiresAt: Date };
  }> {
    const view = await tagService.resolveForScanner(input.publicToken);
    const session = await this.createSession({ publicToken: input.publicToken, ip: input.ip, userAgent: input.userAgent });
    return { view, scannerSession: session };
  },

  async createSession(input: { publicToken: string; ip?: string; userAgent?: string; reasonCode?: string }) {
    const tag = await prisma.tag.findUnique({ where: { publicTokenHash: sha256(input.publicToken) } });
    if (!tag) throw notFound("This code is not valid");

    await this.assertNotRateLimited(tag.id, input.ip);

    const publicSessionId = `scn_${randomToken(12)}`;
    const sessionToken = randomToken(32);
    const risk = this.scoreRisk({ ip: input.ip, userAgent: input.userAgent });

    const session = await prisma.scannerSession.create({
      data: {
        publicSessionId,
        sessionTokenHash: sha256(sessionToken),
        tagId: tag.id,
        reasonCode: input.reasonCode,
        ipHash: input.ip ? sha256(input.ip) : null,
        // Hashed like the IP: a raw user agent is a durable fingerprint, and
        // nothing downstream needs it in a readable form.
        userAgent: input.userAgent ? sha256(input.userAgent.slice(0, 256)) : null,
        riskScore: risk.score,
        riskState: risk.state,
        expiresAt: addMinutes(LIMITS.sessionTtlMinutes),
      },
    });

    await prisma.tagEvent.create({
      data: { tagId: tag.id, eventType: "TAG_SCAN", scannerSessionId: session.id, ipHash: input.ip ? sha256(input.ip) : null },
    });

    log.info({ sessionId: session.id, tagId: tag.id, riskState: risk.state }, "scanner session created");
    return { id: publicSessionId, sessionToken, expiresAt: session.expiresAt };
  },

  /**
   * Resolves and authorizes a scanner session. Every privacy-gateway action goes
   * through here, so ownership, expiry and risk are re-checked each time.
   */
  async authorizeSession(sessionToken: string) {
    const session = await prisma.scannerSession.findUnique({
      where: { sessionTokenHash: sha256(sessionToken) },
      include: { tag: { include: { owner: true, asset: { include: { vehicle: true } } } } },
    });

    if (!session) throw forbidden("Invalid or expired session");
    if (session.status !== "ACTIVE") throw forbidden("This session is no longer active");
    if (session.expiresAt.getTime() <= Date.now()) {
      await prisma.scannerSession.update({ where: { id: session.id }, data: { status: "EXPIRED" } });
      throw forbidden("This session has expired. Please scan the code again.");
    }
    if (session.tag.status !== "ACTIVE") {
      throw new AppError("TAG_INACTIVE", "This tag is no longer active");
    }
    if (session.tag.owner.status !== "ACTIVE") {
      throw new AppError("TAG_INACTIVE", "The owner is not reachable right now");
    }
    return session;
  },

  async setReason(sessionToken: string, reasonCode: string) {
    const session = await this.authorizeSession(sessionToken);
    const assetType = session.tag.asset?.assetType ?? null;
    if (!tagService.reasonIsAllowed(reasonCode, assetType)) {
      throw new AppError("BAD_REQUEST", "That reason is not available for this tag");
    }
    await prisma.scannerSession.update({ where: { id: session.id }, data: { reasonCode } });
    return { reasonCode };
  },

  /**
   * Optional scanner verification. Low-risk actions proceed without it; voice and
   * video require a verified phone so a relay number is not handed to an
   * anonymous caller without friction.
   */
  async verifyScannerPhone(input: { sessionToken: string; phone: string; code: string }) {
    const session = await this.authorizeSession(input.sessionToken);
    const phone = normalizePhone(input.phone);

    await verifyOtp({ phone, code: input.code, purpose: "SCANNER_VERIFY" });

    const updated = await prisma.scannerSession.update({
      where: { id: session.id },
      data: { phoneLookupHmac: lookupHmac(phone, "phone"), phoneVerified: true },
    });
    return { verified: updated.phoneVerified };
  },

  /**
   * Per-tag and per-IP budgets. Implemented against the database so limits hold
   * across instances, not just within one process.
   */
  async assertNotRateLimited(tagId: string, ip?: string): Promise<void> {
    const since = new Date(Date.now() - 60 * 60 * 1000);

    const perTag = await prisma.scannerSession.count({ where: { tagId, createdAt: { gt: since } } });
    if (perTag >= LIMITS.sessionsPerHourPerTag) {
      await this.flag(tagId, "RATE_LIMITED", { scope: "tag", ip });
      throw rateLimited("Too many contact attempts for this tag. Please try again later.");
    }

    if (ip) {
      const ipHash = sha256(ip);
      const perIp = await prisma.scannerSession.count({ where: { ipHash, createdAt: { gt: since } } });
      if (perIp >= LIMITS.sessionsPerHourPerIp) {
        await this.flag(tagId, "RATE_LIMITED", { scope: "ip", ip });
        throw rateLimited("Too many attempts from this network. Please try again later.");
      }
    }
  },

  /** Caps how many communications a single scanner session can create. */
  async assertSessionActionBudget(sessionId: string): Promise<void> {
    const count = await prisma.communicationSession.count({ where: { scannerSessionId: sessionId } });
    if (count >= LIMITS.actionsPerSession) {
      throw rateLimited("You have reached the limit of contact attempts for this scan. Please try again later.");
    }
  },

  /**
   * Heuristic risk scoring (spec 7.3). A production deployment should add
   * device fingerprinting, IP reputation and CAPTCHA escalation on top.
   */
  scoreRisk(input: { ip?: string; userAgent?: string; phoneVerified?: boolean }): {
    score: number;
    state: "LOW" | "MEDIUM" | "HIGH";
  } {
    let score = 0;

    if (!input.userAgent) score += 20;
    else if (/curl|wget|python|postman|scrapy|bot|headless/i.test(input.userAgent)) score += 60;

    if (!input.ip) score += 10;
    if (input.phoneVerified) score -= 40;

    const bounded = Math.max(0, Math.min(100, score));
    return { score: bounded, state: bounded >= 60 ? "HIGH" : bounded >= 30 ? "MEDIUM" : "LOW" };
  },

  /**
   * High-risk sessions must verify before voice/video relay allocation, and are
   * surfaced to the fraud queue.
   */
  requiresOtp(session: { riskScore: number; phoneVerified: boolean; riskState: string }): boolean {
    if (session.phoneVerified) return false;
    return session.riskState === "HIGH" || session.riskScore >= 60;
  },

  async flag(tagId: string, reason: string, meta: Record<string, unknown>): Promise<void> {
    try {
      await prisma.abuseReport.create({
        data: { reporterType: "SYSTEM", reporterRef: "abuse-engine", tagId, reason, riskScore: 0, details: JSON.stringify(meta).slice(0, 500) },
      });
      await audit({ action: `abuse.${reason}`, resourceType: "tag", resourceId: tagId, outcome: "DENIED", metadata: meta });
    } catch (error) {
      log.error({ err: error, tagId, reason }, "failed to record abuse flag");
    }
  },

  chatTtl(): Date {
    return addHours(env.DEFAULT_CHAT_TTL_HOURS);
  },
};
