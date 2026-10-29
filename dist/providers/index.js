"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logProviderSelection = exports.storageProvider = exports.paymentProvider = exports.pushProvider = exports.emailProvider = exports.whatsappProvider = exports.smsProvider = exports.voiceProvider = void 0;
const config_1 = require("../config");
const logger_1 = require("../common/logger");
const mock_1 = require("./mock");
const razorpay_adapter_1 = require("./payments/razorpay.adapter");
const log = (0, logger_1.childLogger)("providers");
/**
 * Provider resolution. Real adapters (Twilio/Exotel/MSG91/Meta/Resend/Razorpay)
 * are added under src/providers/<capability>/<vendor>.adapter.ts and registered
 * here. Until a vendor adapter is implemented, a production environment
 * configured with that vendor fails fast at boot rather than silently sending
 * nothing.
 */
const requireAdapter = (capability, vendor) => {
    throw new Error(`Provider adapter for ${capability}="${vendor}" is not implemented. ` +
        `Implement it in src/providers and register it in src/providers/index.ts, ` +
        `or set the provider to "mock" for local development.`);
};
const resolveVoice = () => {
    switch (config_1.env.VOICE_PROVIDER) {
        case "mock":
            return mock_1.mockVoiceProvider;
        case "twilio":
        case "exotel":
            return requireAdapter("voice", config_1.env.VOICE_PROVIDER);
    }
};
const resolveSms = () => {
    switch (config_1.env.SMS_PROVIDER) {
        case "mock":
            return mock_1.mockSmsProvider;
        case "twilio":
        case "exotel":
        case "msg91":
            return requireAdapter("sms", config_1.env.SMS_PROVIDER);
    }
};
const resolveWhatsApp = () => {
    switch (config_1.env.WHATSAPP_PROVIDER) {
        case "mock":
            return mock_1.mockWhatsAppProvider;
        case "meta":
        case "twilio":
            return requireAdapter("whatsapp", config_1.env.WHATSAPP_PROVIDER);
    }
};
const resolveEmail = () => {
    switch (config_1.env.EMAIL_PROVIDER) {
        case "mock":
            return mock_1.mockEmailProvider;
        case "resend":
        case "smtp":
            return requireAdapter("email", config_1.env.EMAIL_PROVIDER);
    }
};
const resolvePush = () => {
    switch (config_1.env.PUSH_PROVIDER) {
        case "mock":
            return mock_1.mockPushProvider;
        case "fcm":
            return requireAdapter("push", config_1.env.PUSH_PROVIDER);
    }
};
const resolvePayment = () => {
    switch (config_1.env.PAYMENT_PROVIDER) {
        case "mock":
            return mock_1.mockPaymentProvider;
        case "razorpay":
            return razorpay_adapter_1.razorpayProvider;
    }
};
exports.voiceProvider = resolveVoice();
exports.smsProvider = resolveSms();
exports.whatsappProvider = resolveWhatsApp();
exports.emailProvider = resolveEmail();
exports.pushProvider = resolvePush();
exports.paymentProvider = resolvePayment();
/**
 * Object storage (MinIO in development, R2/S3/B2 in production).
 * Documents never transit the API in plaintext: the client uploads directly
 * to storage with a short-lived signed URL (spec 21).
 */
exports.storageProvider = {
    name: "local",
    async createSignedUploadUrl() {
        throw new Error("storageProvider.createSignedUploadUrl requires a MinIO/S3 adapter. " +
            "Implement src/providers/storage and register it here.");
    },
    async createSignedDownloadUrl() {
        throw new Error("storageProvider.createSignedDownloadUrl requires a MinIO/S3 adapter. " +
            "Implement src/providers/storage and register it here.");
    },
    async deleteObject() {
        /* no-op in the local adapter */
    },
};
const logProviderSelection = () => {
    log.info({
        voice: exports.voiceProvider.name,
        sms: exports.smsProvider.name,
        whatsapp: exports.whatsappProvider.name,
        email: exports.emailProvider.name,
        push: exports.pushProvider.name,
        payments: exports.paymentProvider.name,
    }, "providers resolved");
};
exports.logProviderSelection = logProviderSelection;
//# sourceMappingURL=index.js.map