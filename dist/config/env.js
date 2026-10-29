"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const zod_1 = require("zod");
// Load .env for local development. Real variables always win, and a missing
// file is fine because production injects configuration from the platform.
if ((0, node_fs_1.existsSync)((0, node_path_1.resolve)(process.cwd(), ".env"))) {
    try {
        process.loadEnvFile();
    }
    catch {
        /* already loaded, or unreadable; env vars from the platform take precedence */
    }
}
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(["development", "test", "production"]).default("development"),
    PORT: zod_1.z.coerce.number().int().positive().default(4000),
    API_BASE_URL: zod_1.z.string().default("http://localhost:4000"),
    WEB_BASE_URL: zod_1.z.string().default("http://localhost:3000"),
    ADMIN_BASE_URL: zod_1.z.string().default("http://localhost:3001"),
    APP_NAME: zod_1.z.string().default("Sampark"),
    LOG_LEVEL: zod_1.z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    DATABASE_URL: zod_1.z.string().default("postgresql://sampark:sampark@localhost:5432/sampark?schema=public"),
    REDIS_URL: zod_1.z.string().default("redis://localhost:6379"),
    JWT_ACCESS_SECRET: zod_1.z.string().min(32).default("dev-access-secret-change-me-32-chars-min"),
    JWT_REFRESH_SECRET: zod_1.z.string().min(32).default("dev-refresh-secret-change-me-32-chars-min"),
    JWT_ACCESS_TTL: zod_1.z.string().default("15m"),
    JWT_REFRESH_TTL: zod_1.z.string().default("30d"),
    FIELD_ENCRYPTION_KEY: zod_1.z
        .string()
        .length(64)
        .default("0000000000000000000000000000000000000000000000000000000000000000"),
    FIELD_ENCRYPTION_KEY_V1: zod_1.z
        .string()
        .length(64)
        .optional()
        .describe("Previous field-encryption key, used during key rotation"),
    LOOKUP_HMAC_KEY: zod_1.z.string().min(16).default("dev-lookup-hmac-key"),
    OTP_SECRET: zod_1.z.string().min(16).default("dev-otp-secret"),
    OTP_TTL_SECONDS: zod_1.z.coerce.number().int().default(300),
    OTP_MAX_ATTEMPTS: zod_1.z.coerce.number().int().default(5),
    CORS_ORIGINS: zod_1.z
        .string()
        .default("http://localhost:3000,http://localhost:3001,http://localhost:19006")
        .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
    RATE_LIMIT_WINDOW_MS: zod_1.z.coerce.number().int().default(60_000),
    RATE_LIMIT_MAX: zod_1.z.coerce.number().int().default(120),
    SCANNER_RATE_LIMIT_MAX: zod_1.z.coerce.number().int().default(10),
    VOICE_PROVIDER: zod_1.z.enum(["mock", "twilio", "exotel"]).default("mock"),
    SMS_PROVIDER: zod_1.z.enum(["mock", "twilio", "exotel", "msg91"]).default("mock"),
    WHATSAPP_PROVIDER: zod_1.z.enum(["mock", "meta", "twilio"]).default("mock"),
    EMAIL_PROVIDER: zod_1.z.enum(["mock", "resend", "smtp"]).default("mock"),
    PAYMENT_PROVIDER: zod_1.z.enum(["mock", "razorpay"]).default("mock"),
    PUSH_PROVIDER: zod_1.z.enum(["mock", "fcm"]).default("mock"),
    MAX_CALL_DURATION_SECONDS: zod_1.z.coerce.number().int().default(300),
    CALL_RECORDING_ENABLED: zod_1.z
        .enum(["true", "false"])
        .default("false")
        .transform((v) => v === "true"),
    DEFAULT_LOCATION_SHARE_TTL_MINUTES: zod_1.z.coerce.number().int().default(30),
    DEFAULT_CHAT_TTL_HOURS: zod_1.z.coerce.number().int().default(24),
    MAX_ATTACHMENT_BYTES: zod_1.z.coerce.number().int().default(10 * 1024 * 1024),
    TURN_URL: zod_1.z.string().optional(),
    TURN_USERNAME: zod_1.z.string().optional(),
    TURN_CREDENTIAL: zod_1.z.string().optional(),
    RAZORPAY_KEY_ID: zod_1.z.string().optional(),
    RAZORPAY_KEY_SECRET: zod_1.z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: zod_1.z.string().optional(),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
}
exports.env = parsed.data;
//# sourceMappingURL=env.js.map