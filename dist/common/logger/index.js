"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.childLogger = exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const config_1 = require("../../config");
exports.logger = (0, pino_1.default)({
    level: config_1.env.LOG_LEVEL,
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
    transport: config_1.env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
        : undefined,
});
const childLogger = (mod) => exports.logger.child({ module: mod });
exports.childLogger = childLogger;
//# sourceMappingURL=index.js.map