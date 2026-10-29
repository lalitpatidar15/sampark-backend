import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

// Load .env for local development. Real variables always win, and a missing
// file is fine because production injects configuration from the platform.
if (existsSync(resolve(process.cwd(), ".env"))) {
  try {
    process.loadEnvFile();
  } catch {
    /* already loaded, or unreadable; env vars from the platform take precedence */
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: z.string().default("http://localhost:4000"),
  WEB_BASE_URL: z.string().default("http://localhost:3000"),
  ADMIN_BASE_URL: z.string().default("http://localhost:3001"),
  APP_NAME: z.string().default("Sampark"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().default("postgresql://sampark:sampark@localhost:5432/sampark?schema=public"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  JWT_ACCESS_SECRET: z.string().min(32).default("dev-access-secret-change-me-32-chars-min"),
  JWT_REFRESH_SECRET: z.string().min(32).default("dev-refresh-secret-change-me-32-chars-min"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  FIELD_ENCRYPTION_KEY: z
    .string()
    .length(64)
    .default("0000000000000000000000000000000000000000000000000000000000000000"),
  FIELD_ENCRYPTION_KEY_V1: z
    .string()
    .length(64)
    .optional()
    .describe("Previous field-encryption key, used during key rotation"),
  LOOKUP_HMAC_KEY: z.string().min(16).default("dev-lookup-hmac-key"),
  OTP_SECRET: z.string().min(16).default("dev-otp-secret"),
  OTP_TTL_SECONDS: z.coerce.number().int().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().default(5),

  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:3001,http://localhost:19006")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().default(120),
  SCANNER_RATE_LIMIT_MAX: z.coerce.number().int().default(10),

  VOICE_PROVIDER: z.enum(["mock", "twilio", "exotel"]).default("mock"),
  SMS_PROVIDER: z.enum(["mock", "twilio", "exotel", "msg91"]).default("mock"),
  WHATSAPP_PROVIDER: z.enum(["mock", "meta", "twilio"]).default("mock"),
  EMAIL_PROVIDER: z.enum(["mock", "resend", "smtp"]).default("mock"),
  PAYMENT_PROVIDER: z.enum(["mock", "razorpay"]).default("mock"),
  PUSH_PROVIDER: z.enum(["mock", "fcm"]).default("mock"),

  MAX_CALL_DURATION_SECONDS: z.coerce.number().int().default(300),
  CALL_RECORDING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  DEFAULT_LOCATION_SHARE_TTL_MINUTES: z.coerce.number().int().default(30),
  DEFAULT_CHAT_TTL_HOURS: z.coerce.number().int().default(24),
  MAX_ATTACHMENT_BYTES: z.coerce.number().int().default(10 * 1024 * 1024),

  TURN_URL: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;
