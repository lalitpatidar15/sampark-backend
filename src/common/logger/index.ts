import pino from "pino";
import { env } from "../../config";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "sampark-backend" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "phone",
      "phoneEncrypted",
      "phone_encrypted",
      "emailEncrypted",
      "email_encrypted",
      "nameEncrypted",
      "name_encrypted",
      "addressEncrypted",
      "address_encrypted",
      "registrationEncrypted",
      "registration_encrypted",
      "*.password",
      "*.phone",
      "*.phoneEncrypted",
      "*.phone_encrypted",
      "*.email",
      "*.emailEncrypted",
      "*.email_encrypted",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});

export const childLogger = (mod: string) => logger.child({ module: mod });
