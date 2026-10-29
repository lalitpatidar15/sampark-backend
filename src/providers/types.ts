/**
 * Communication provider interfaces.
 *
 * Every external capability is reached through one of these contracts so a
 * regional provider can be swapped without touching product logic
 * (spec 10.5, 31B.3). Route handlers must never call a vendor SDK directly.
 */

export type ChannelName = "VOICE" | "VIDEO" | "SMS" | "WHATSAPP" | "CHAT" | "PUSH";

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export interface InitiateCallInput {
  /** Provider-side reference for the caller leg (scanner, no real number). */
  callerReference: string;
  /** Relay number to dial. The owner's real number is never passed to the provider. */
  relayNumber: string;
  ownerReference: string;
  sessionId: string;
  maxDurationSeconds: number;
  statusCallbackUrl: string;
  record: boolean;
}

export interface CallResult {
  providerCallId: string;
  relayNumber: string;
  status: "QUEUED" | "RINGING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "NO_ANSWER";
  provider: string;
}

export interface CallStatus {
  providerCallId: string;
  status: string;
  durationSeconds: number;
  hangupReason?: string;
}

export interface VoiceProvider {
  readonly name: string;
  initiateCall(input: InitiateCallInput): Promise<CallResult>;
  getCallStatus(providerCallId: string): Promise<CallStatus>;
  hangupCall(providerCallId: string): Promise<void>;
  /** Reserve a relay number from the provider's number pool. */
  allocateRelay(): Promise<{ relayNumber: string; reference: string }>;
  releaseRelay(reference: string): Promise<void>;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
}

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

export interface SendSmsInput {
  to: string;
  body: string;
  templateKey?: string;
  /** Indian DLT requires a registered sender id and content template. */
  senderId?: string;
  dltTemplateId?: string;
  idempotencyKey?: string;
}

export interface SendResult {
  providerMessageId: string;
  status: "QUEUED" | "SENT" | "FAILED";
  provider: string;
}

export interface SmsProvider {
  readonly name: string;
  send(input: SendSmsInput): Promise<SendResult>;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

export type WhatsAppMode = "NOTIFICATION" | "TWO_WAY_RELAY";

export interface SendWhatsAppInput {
  to: string;
  body: string;
  mode: WhatsAppMode;
  templateName?: string;
  /** Outside the 24h customer-care window, only approved templates are allowed. */
  conversationReference?: string;
  idempotencyKey?: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  send(input: SendWhatsAppInput): Promise<SendResult>;
  markRead(providerMessageId: string): Promise<void>;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  idempotencyKey?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(input: SendEmailInput): Promise<SendResult>;
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

export interface PushProvider {
  readonly name: string;
  send(input: {
    deviceTokens: string[];
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<{ successCount: number; failureCount: number }>;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export interface CreatePaymentOrderInput {
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface PaymentProvider {
  readonly name: string;
  createOrder(input: CreatePaymentOrderInput): Promise<{
    providerOrderId: string;
    amount: number;
    currency: string;
  }>;
  verifySignature(input: Record<string, string>, signature: string): boolean;
  refund(providerPaymentId: string, amount?: number): Promise<{ refundId: string }>;
}

// ---------------------------------------------------------------------------
// Object storage
// ---------------------------------------------------------------------------

export interface SignedUploadUrl {
  objectKey: string;
  uploadUrl: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StorageProvider {
  readonly name: string;
  createSignedUploadUrl(input: {
    objectKey: string;
    contentType: string;
    contentLength: number;
    ttlSeconds: number;
  }): Promise<SignedUploadUrl>;
  createSignedDownloadUrl(input: { objectKey: string; ttlSeconds: number }): Promise<string>;
  deleteObject(objectKey: string): Promise<void>;
}
