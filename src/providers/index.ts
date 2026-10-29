import { env } from "../config";
import { childLogger } from "../common/logger";
import {
  mockEmailProvider,
  mockPaymentProvider,
  mockPushProvider,
  mockSmsProvider,
  mockVoiceProvider,
  mockWhatsAppProvider,
} from "./mock";
import { razorpayProvider } from "./payments/razorpay.adapter";
import type {
  EmailProvider,
  PaymentProvider,
  PushProvider,
  SmsProvider,
  StorageProvider,
  VoiceProvider,
  WhatsAppProvider,
} from "./types";

const log = childLogger("providers");

/**
 * Provider resolution. Real adapters (Twilio/Exotel/MSG91/Meta/Resend/Razorpay)
 * are added under src/providers/<capability>/<vendor>.adapter.ts and registered
 * here. Until a vendor adapter is implemented, a production environment
 * configured with that vendor fails fast at boot rather than silently sending
 * nothing.
 */

const requireAdapter = <T>(capability: string, vendor: string): T => {
  throw new Error(
    `Provider adapter for ${capability}="${vendor}" is not implemented. ` +
      `Implement it in src/providers and register it in src/providers/index.ts, ` +
      `or set the provider to "mock" for local development.`,
  );
};

const resolveVoice = (): VoiceProvider => {
  switch (env.VOICE_PROVIDER) {
    case "mock":
      return mockVoiceProvider;
    case "twilio":
    case "exotel":
      return requireAdapter<VoiceProvider>("voice", env.VOICE_PROVIDER);
  }
};

const resolveSms = (): SmsProvider => {
  switch (env.SMS_PROVIDER) {
    case "mock":
      return mockSmsProvider;
    case "twilio":
    case "exotel":
    case "msg91":
      return requireAdapter<SmsProvider>("sms", env.SMS_PROVIDER);
  }
};

const resolveWhatsApp = (): WhatsAppProvider => {
  switch (env.WHATSAPP_PROVIDER) {
    case "mock":
      return mockWhatsAppProvider;
    case "meta":
    case "twilio":
      return requireAdapter<WhatsAppProvider>("whatsapp", env.WHATSAPP_PROVIDER);
  }
};

const resolveEmail = (): EmailProvider => {
  switch (env.EMAIL_PROVIDER) {
    case "mock":
      return mockEmailProvider;
    case "resend":
    case "smtp":
      return requireAdapter<EmailProvider>("email", env.EMAIL_PROVIDER);
  }
};

const resolvePush = (): PushProvider => {
  switch (env.PUSH_PROVIDER) {
    case "mock":
      return mockPushProvider;
    case "fcm":
      return requireAdapter<PushProvider>("push", env.PUSH_PROVIDER);
  }
};

const resolvePayment = (): PaymentProvider => {
  switch (env.PAYMENT_PROVIDER) {
    case "mock":
      return mockPaymentProvider;
    case "razorpay":
      return razorpayProvider;
  }
};

export const voiceProvider = resolveVoice();
export const smsProvider = resolveSms();
export const whatsappProvider = resolveWhatsApp();
export const emailProvider = resolveEmail();
export const pushProvider = resolvePush();
export const paymentProvider = resolvePayment();

/**
 * Object storage (MinIO in development, R2/S3/B2 in production).
 * Documents never transit the API in plaintext: the client uploads directly
 * to storage with a short-lived signed URL (spec 21).
 */
export const storageProvider: StorageProvider = {
  name: "local",
  async createSignedUploadUrl() {
    throw new Error(
      "storageProvider.createSignedUploadUrl requires a MinIO/S3 adapter. " +
        "Implement src/providers/storage and register it here.",
    );
  },
  async createSignedDownloadUrl() {
    throw new Error(
      "storageProvider.createSignedDownloadUrl requires a MinIO/S3 adapter. " +
        "Implement src/providers/storage and register it here.",
    );
  },
  async deleteObject() {
    /* no-op in the local adapter */
  },
};

export const logProviderSelection = (): void => {
  log.info(
    {
      voice: voiceProvider.name,
      sms: smsProvider.name,
      whatsapp: whatsappProvider.name,
      email: emailProvider.name,
      push: pushProvider.name,
      payments: paymentProvider.name,
    },
    "providers resolved",
  );
};

export type {
  EmailProvider,
  PaymentProvider,
  PushProvider,
  SmsProvider,
  StorageProvider,
  VoiceProvider,
  WhatsAppProvider,
};
