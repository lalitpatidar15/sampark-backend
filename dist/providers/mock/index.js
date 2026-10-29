"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockPaymentProvider = exports.mockPushProvider = exports.mockEmailProvider = exports.mockWhatsAppProvider = exports.mockSmsProvider = exports.mockVoiceProvider = void 0;
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../config");
const logger_1 = require("../../common/logger");
const log = (0, logger_1.childLogger)("provider:mock");
/**
 * Development providers. They perform the full state machine and webhook
 * shape of a real provider but make no network calls, so the whole product
 * (privacy gateway, routing, limits, audit) is testable without paid credits.
 * Never select these in production: env validation pins production to real adapters.
 */
class MockVoiceProvider {
    name = "mock";
    calls = new Map();
    async initiateCall(input) {
        const providerCallId = `mock_call_${(0, node_crypto_1.randomUUID)()}`;
        this.calls.set(providerCallId, { status: "RINGING", startedAt: Date.now() });
        log.info({ providerCallId, sessionId: input.sessionId, record: input.record }, "mock call initiated");
        return { providerCallId, relayNumber: input.relayNumber, status: "RINGING", provider: this.name };
    }
    async getCallStatus(providerCallId) {
        const call = this.calls.get(providerCallId);
        if (!call)
            return { providerCallId, status: "FAILED", durationSeconds: 0, hangupReason: "NOT_FOUND" };
        const durationSeconds = Math.floor((Date.now() - call.startedAt) / 1000);
        return {
            providerCallId,
            status: durationSeconds >= config_1.env.MAX_CALL_DURATION_SECONDS ? "COMPLETED" : call.status,
            durationSeconds,
        };
    }
    async hangupCall(providerCallId) {
        const call = this.calls.get(providerCallId);
        if (call)
            call.status = "COMPLETED";
    }
    async allocateRelay() {
        // A reference, not a dialable number — nothing in this app stores a real number.
        return { relayNumber: "+910000000000", reference: `relay_${(0, node_crypto_1.randomUUID)()}` };
    }
    async releaseRelay(reference) {
        log.debug({ reference }, "mock relay released");
    }
    verifyWebhookSignature(rawBody, signature) {
        return verifyHmacSignature(rawBody, signature, config_1.env.OTP_SECRET);
    }
}
class MockSmsProvider {
    name = "mock";
    async send(input) {
        const providerMessageId = `mock_sms_${(0, node_crypto_1.randomUUID)()}`;
        log.info({ providerMessageId, templateKey: input.templateKey, toMasked: maskLogPhone(input.to) }, "mock sms sent");
        return { providerMessageId, status: "SENT", provider: this.name };
    }
    verifyWebhookSignature(rawBody, signature) {
        return verifyHmacSignature(rawBody, signature, config_1.env.OTP_SECRET);
    }
}
class MockWhatsAppProvider {
    name = "mock";
    async send(input) {
        const providerMessageId = `mock_wa_${(0, node_crypto_1.randomUUID)()}`;
        log.info({ providerMessageId, mode: input.mode, templateName: input.templateName }, "mock whatsapp sent");
        return { providerMessageId, status: "SENT", provider: this.name };
    }
    async markRead() {
        log.debug("mock whatsapp marked read");
    }
    verifyWebhookSignature(rawBody, signature) {
        return verifyHmacSignature(rawBody, signature, config_1.env.OTP_SECRET);
    }
}
class MockEmailProvider {
    name = "mock";
    async send(input) {
        const providerMessageId = `mock_email_${(0, node_crypto_1.randomUUID)()}`;
        log.info({ providerMessageId, to: maskLogEmail(input.to), subject: input.subject }, "mock email sent");
        return { providerMessageId, status: "SENT", provider: this.name };
    }
}
class MockPushProvider {
    name = "mock";
    async send(input) {
        log.info({ tokens: input.deviceTokens.length, title: input.title }, "mock push sent");
        return { successCount: input.deviceTokens.length, failureCount: 0 };
    }
}
class MockPaymentProvider {
    name = "mock";
    async createOrder(input) {
        return { providerOrderId: `mock_order_${input.receipt}`, amount: input.amount, currency: input.currency };
    }
    verifySignature(input, signature) {
        const expected = (0, node_crypto_1.createHmac)("sha256", config_1.env.OTP_SECRET).update(JSON.stringify(input)).digest("hex");
        return safeEqualHex(expected, signature);
    }
    async refund(providerPaymentId) {
        return { refundId: `mock_refund_${providerPaymentId}` };
    }
}
const verifyHmacSignature = (rawBody, signature, secret) => {
    if (!signature)
        return false;
    const expected = (0, node_crypto_1.createHmac)("sha256", secret).update(rawBody).digest("hex");
    return safeEqualHex(expected, signature);
};
const safeEqualHex = (a, b) => {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    return bufA.length === bufB.length && (0, node_crypto_1.timingSafeEqual)(bufA, bufB);
};
const maskLogPhone = (phone) => `${phone.slice(-4).padStart(10, "*")}`;
const maskLogEmail = (email) => {
    const [local, domain] = email.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
};
exports.mockVoiceProvider = new MockVoiceProvider();
exports.mockSmsProvider = new MockSmsProvider();
exports.mockWhatsAppProvider = new MockWhatsAppProvider();
exports.mockEmailProvider = new MockEmailProvider();
exports.mockPushProvider = new MockPushProvider();
exports.mockPaymentProvider = new MockPaymentProvider();
//# sourceMappingURL=index.js.map