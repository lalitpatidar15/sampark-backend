import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../../config";
import { childLogger } from "../../common/logger";
import type {
  CallResult,
  CallStatus,
  EmailProvider,
  InitiateCallInput,
  PaymentProvider,
  PushProvider,
  SendEmailInput,
  SendResult,
  SendSmsInput,
  SendWhatsAppInput,
  SmsProvider,
  VoiceProvider,
  WhatsAppProvider,
} from "../types";

const log = childLogger("provider:mock");

/**
 * Development providers. They perform the full state machine and webhook
 * shape of a real provider but make no network calls, so the whole product
 * (privacy gateway, routing, limits, audit) is testable without paid credits.
 * Never select these in production: env validation pins production to real adapters.
 */

class MockVoiceProvider implements VoiceProvider {
  readonly name = "mock";
  private readonly calls = new Map<string, { status: CallResult["status"]; startedAt: number }>();

  async initiateCall(input: InitiateCallInput): Promise<CallResult> {
    const providerCallId = `mock_call_${randomUUID()}`;
    this.calls.set(providerCallId, { status: "RINGING", startedAt: Date.now() });
    log.info({ providerCallId, sessionId: input.sessionId, record: input.record }, "mock call initiated");
    return { providerCallId, relayNumber: input.relayNumber, status: "RINGING", provider: this.name };
  }

  async getCallStatus(providerCallId: string): Promise<CallStatus> {
    const call = this.calls.get(providerCallId);
    if (!call) return { providerCallId, status: "FAILED", durationSeconds: 0, hangupReason: "NOT_FOUND" };
    const durationSeconds = Math.floor((Date.now() - call.startedAt) / 1000);
    return {
      providerCallId,
      status: durationSeconds >= env.MAX_CALL_DURATION_SECONDS ? "COMPLETED" : call.status,
      durationSeconds,
    };
  }

  async hangupCall(providerCallId: string): Promise<void> {
    const call = this.calls.get(providerCallId);
    if (call) call.status = "COMPLETED";
  }

  async allocateRelay(): Promise<{ relayNumber: string; reference: string }> {
    // A reference, not a dialable number — nothing in this app stores a real number.
    return { relayNumber: "+910000000000", reference: `relay_${randomUUID()}` };
  }

  async releaseRelay(reference: string): Promise<void> {
    log.debug({ reference }, "mock relay released");
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    return verifyHmacSignature(rawBody, signature, env.OTP_SECRET);
  }
}

class MockSmsProvider implements SmsProvider {
  readonly name = "mock";
  async send(input: SendSmsInput): Promise<SendResult> {
    const providerMessageId = `mock_sms_${randomUUID()}`;
    log.info({ providerMessageId, templateKey: input.templateKey, toMasked: maskLogPhone(input.to) }, "mock sms sent");
    return { providerMessageId, status: "SENT", provider: this.name };
  }
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    return verifyHmacSignature(rawBody, signature, env.OTP_SECRET);
  }
}

class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";
  async send(input: SendWhatsAppInput): Promise<SendResult> {
    const providerMessageId = `mock_wa_${randomUUID()}`;
    log.info({ providerMessageId, mode: input.mode, templateName: input.templateName }, "mock whatsapp sent");
    return { providerMessageId, status: "SENT", provider: this.name };
  }
  async markRead(): Promise<void> {
    log.debug("mock whatsapp marked read");
  }
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    return verifyHmacSignature(rawBody, signature, env.OTP_SECRET);
  }
}

class MockEmailProvider implements EmailProvider {
  readonly name = "mock";
  async send(input: SendEmailInput): Promise<SendResult> {
    const providerMessageId = `mock_email_${randomUUID()}`;
    log.info({ providerMessageId, to: maskLogEmail(input.to), subject: input.subject }, "mock email sent");
    return { providerMessageId, status: "SENT", provider: this.name };
  }
}

class MockPushProvider implements PushProvider {
  readonly name = "mock";
  async send(input: { deviceTokens: string[]; title: string; body: string }): Promise<{
    successCount: number;
    failureCount: number;
  }> {
    log.info({ tokens: input.deviceTokens.length, title: input.title }, "mock push sent");
    return { successCount: input.deviceTokens.length, failureCount: 0 };
  }
}

class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  async createOrder(input: { amount: number; currency: string; receipt: string }) {
    return { providerOrderId: `mock_order_${input.receipt}`, amount: input.amount, currency: input.currency };
  }
  verifySignature(input: Record<string, string>, signature: string): boolean {
    const expected = createHmac("sha256", env.OTP_SECRET).update(JSON.stringify(input)).digest("hex");
    return safeEqualHex(expected, signature);
  }
  async refund(providerPaymentId: string): Promise<{ refundId: string }> {
    return { refundId: `mock_refund_${providerPaymentId}` };
  }
}

const verifyHmacSignature = (rawBody: Buffer, signature: string | undefined, secret: string): boolean => {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
};

const safeEqualHex = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

const maskLogPhone = (phone: string): string => `${phone.slice(-4).padStart(10, "*")}`;
const maskLogEmail = (email: string): string => {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
};

export const mockVoiceProvider = new MockVoiceProvider();
export const mockSmsProvider = new MockSmsProvider();
export const mockWhatsAppProvider = new MockWhatsAppProvider();
export const mockEmailProvider = new MockEmailProvider();
export const mockPushProvider = new MockPushProvider();
export const mockPaymentProvider = new MockPaymentProvider();
