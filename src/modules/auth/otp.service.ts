import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../../db/prisma";
import { env } from "../../config";
import { AppError } from "../../common/errors";
import { lookupHmac, normalizePhone, randomOtp } from "../../common/utils/crypto";
import { addSeconds } from "../../common/utils/time";
import { smsProvider } from "../../providers";
import { childLogger } from "../../common/logger";

const log = childLogger("otp");

export type OtpPurpose = "LOGIN" | "REAUTH" | "REGISTRATION" | "SCANNER_VERIFY" | "TAG_TRANSFER";

export interface OtpRequestResult {
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** Dev mock: returned when SMS_PROVIDER=mock so the flow is testable without SMS integration. */
  devCode?: string;
}

const hashCode = (challengeId: string, code: string): string =>
  createHmac("sha256", env.OTP_SECRET).update(`${challengeId}:${code}`).digest("hex");

/**
 * OTP codes are never stored in plaintext: only a keyed hash plus an attempt
 * counter, so a database read cannot be used to complete a login.
 */
export const requestOtp = async (input: {
  phone: string;
  purpose: OtpPurpose;
  meta?: Record<string, unknown>;
}): Promise<OtpRequestResult> => {
  const phone = normalizePhone(input.phone);
  const subjectHash = lookupHmac(phone, "phone");

  const recent = await prisma.otpChallenge.findFirst({
    where: { subjectHash, purpose: input.purpose, createdAt: { gt: new Date(Date.now() - 60_000) } },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    throw new AppError("RATE_LIMITED", "Please wait before requesting another code");
  }

  const code = randomOtp(6);
  const expiresAt = addSeconds(env.OTP_TTL_SECONDS);
  const challenge = await prisma.otpChallenge.create({
    data: {
      subjectHash,
      purpose: input.purpose,
      codeHash: "pending",
      maxAttempts: env.OTP_MAX_ATTEMPTS,
      expiresAt,
    },
  });

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { codeHash: hashCode(challenge.id, code) },
  });

  const isMock = env.SMS_PROVIDER === "mock";
  await smsProvider.send({
    to: phone,
    body: `${env.APP_NAME} verification code: ${code}. Valid for ${Math.floor(env.OTP_TTL_SECONDS / 60)} minutes. Do not share it with anyone.`,
    templateKey: `OTP_${input.purpose}`,
    idempotencyKey: `otp:${challenge.id}`,
  });

  log.info({ purpose: input.purpose, challengeId: challenge.id }, "otp issued");

  return {
    expiresInSeconds: env.OTP_TTL_SECONDS,
    resendAfterSeconds: 60,
    ...(isMock ? { devCode: code } : {}),
  };
};

export const verifyOtp = async (input: { phone: string; code: string; purpose: OtpPurpose }): Promise<void> => {
  const phone = normalizePhone(input.phone);
  const subjectHash = lookupHmac(phone, "phone");

  const challenge = await prisma.otpChallenge.findFirst({
    where: { subjectHash, purpose: input.purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) throw new AppError("OTP_EXPIRED", "No active verification code. Request a new one.");
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new AppError("OTP_EXPIRED", "Verification code has expired");
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    throw new AppError("OTP_INVALID", "Too many incorrect attempts. Request a new code.");
  }

  const expected = Buffer.from(challenge.codeHash, "hex");
  const received = Buffer.from(hashCode(challenge.id, input.code), "hex");
  const matches = expected.length === received.length && timingSafeEqual(expected, received);

  if (!matches) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError("OTP_INVALID", "Incorrect verification code");
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });
};
