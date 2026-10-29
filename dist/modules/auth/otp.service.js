"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyOtp = exports.requestOtp = void 0;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../../db/prisma");
const config_1 = require("../../config");
const errors_1 = require("../../common/errors");
const crypto_1 = require("../../common/utils/crypto");
const time_1 = require("../../common/utils/time");
const providers_1 = require("../../providers");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("otp");
const hashCode = (challengeId, code) => (0, node_crypto_1.createHmac)("sha256", config_1.env.OTP_SECRET).update(`${challengeId}:${code}`).digest("hex");
/**
 * OTP codes are never stored in plaintext: only a keyed hash plus an attempt
 * counter, so a database read cannot be used to complete a login.
 */
const requestOtp = async (input) => {
    const phone = (0, crypto_1.normalizePhone)(input.phone);
    const subjectHash = (0, crypto_1.lookupHmac)(phone, "phone");
    const recent = await prisma_1.prisma.otpChallenge.findFirst({
        where: { subjectHash, purpose: input.purpose, createdAt: { gt: new Date(Date.now() - 60_000) } },
        orderBy: { createdAt: "desc" },
    });
    if (recent) {
        throw new errors_1.AppError("RATE_LIMITED", "Please wait before requesting another code");
    }
    const code = (0, crypto_1.randomOtp)(6);
    const expiresAt = (0, time_1.addSeconds)(config_1.env.OTP_TTL_SECONDS);
    const challenge = await prisma_1.prisma.otpChallenge.create({
        data: {
            subjectHash,
            purpose: input.purpose,
            codeHash: "pending",
            maxAttempts: config_1.env.OTP_MAX_ATTEMPTS,
            expiresAt,
        },
    });
    await prisma_1.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { codeHash: hashCode(challenge.id, code) },
    });
    const isDev = config_1.env.NODE_ENV !== "production" && config_1.env.SMS_PROVIDER === "mock";
    await providers_1.smsProvider.send({
        to: phone,
        body: `${config_1.env.APP_NAME} verification code: ${code}. Valid for ${Math.floor(config_1.env.OTP_TTL_SECONDS / 60)} minutes. Do not share it with anyone.`,
        templateKey: `OTP_${input.purpose}`,
        idempotencyKey: `otp:${challenge.id}`,
    });
    log.info({ purpose: input.purpose, challengeId: challenge.id }, "otp issued");
    return {
        expiresInSeconds: config_1.env.OTP_TTL_SECONDS,
        resendAfterSeconds: 60,
        ...(isDev ? { devCode: code } : {}),
    };
};
exports.requestOtp = requestOtp;
const verifyOtp = async (input) => {
    const phone = (0, crypto_1.normalizePhone)(input.phone);
    const subjectHash = (0, crypto_1.lookupHmac)(phone, "phone");
    const challenge = await prisma_1.prisma.otpChallenge.findFirst({
        where: { subjectHash, purpose: input.purpose, consumedAt: null },
        orderBy: { createdAt: "desc" },
    });
    if (!challenge)
        throw new errors_1.AppError("OTP_EXPIRED", "No active verification code. Request a new one.");
    if (challenge.expiresAt.getTime() <= Date.now()) {
        throw new errors_1.AppError("OTP_EXPIRED", "Verification code has expired");
    }
    if (challenge.attempts >= challenge.maxAttempts) {
        throw new errors_1.AppError("OTP_INVALID", "Too many incorrect attempts. Request a new code.");
    }
    const expected = Buffer.from(challenge.codeHash, "hex");
    const received = Buffer.from(hashCode(challenge.id, input.code), "hex");
    const matches = expected.length === received.length && (0, node_crypto_1.timingSafeEqual)(expected, received);
    if (!matches) {
        await prisma_1.prisma.otpChallenge.update({
            where: { id: challenge.id },
            data: { attempts: { increment: 1 } },
        });
        throw new errors_1.AppError("OTP_INVALID", "Incorrect verification code");
    }
    await prisma_1.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
    });
};
exports.verifyOtp = verifyOtp;
//# sourceMappingURL=otp.service.js.map