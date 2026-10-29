"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASKED_PLACEHOLDER = exports.generatePublicTagToken = exports.safeEqual = exports.sha256 = exports.randomOtp = exports.randomToken = exports.maskRegistration = exports.maskPhone = exports.normalizeRegistration = exports.normalizeEmail = exports.normalizePhone = exports.lookupHmac = exports.decryptField = exports.encryptField = exports.FIELD = void 0;
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../config");
const errors_1 = require("../errors");
const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const buildKeyring = () => {
    const active = Buffer.from(config_1.env.FIELD_ENCRYPTION_KEY, "hex");
    if (active.length !== KEY_LENGTH) {
        throw new Error("FIELD_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
    }
    const previous = config_1.env.FIELD_ENCRYPTION_KEY_V1
        ? Buffer.from(config_1.env.FIELD_ENCRYPTION_KEY_V1, "hex")
        : undefined;
    return { active, previous, version: "v1" };
};
const keyring = buildKeyring();
/**
 * The authenticated-encryption context ("AAD") for every encrypted column.
 *
 * The context is bound into the auth tag, so encrypting with one string and
 * decrypting with another fails closed. That is a useful safety property, but
 * it means the strings have to be agreed on. Keeping them here, rather than as
 * literals scattered across services and the seed script, is what stops a
 * writer and a reader from drifting apart and producing rows that can never be
 * read again.
 */
exports.FIELD = {
    userName: "name",
    userPhone: "phone",
    userEmail: "email",
    pushToken: "push_token",
    vehicleRegistration: "registration",
    tagPublicToken: "tag_token",
    emergencyRelationship: "relationship",
    bloodGroup: "blood_group",
    insuranceProvider: "insurance_provider",
    insurancePolicy: "insurance_policy",
    firstResponderNote: "responder_note",
    location: "location",
    messageBody: "message",
    mfaSecret: "mfa_secret",
};
/**
 * Encrypted payload format (base64url segments):
 *   enc:v1:<iv>:<authTag>:<ciphertext>
 */
const encryptField = (plaintext, context = "default") => {
    const iv = (0, node_crypto_1.randomBytes)(IV_LENGTH);
    const cipher = (0, node_crypto_1.createCipheriv)(ALGO, keyring.active, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
        "enc",
        keyring.version,
        iv.toString("base64url"),
        authTag.toString("base64url"),
        ciphertext.toString("base64url"),
    ].join(":");
};
exports.encryptField = encryptField;
const decryptField = (payload, context = "default") => {
    const parts = payload.split(":");
    if (parts.length !== 5 || parts[0] !== "enc") {
        throw new errors_1.AppError("INTERNAL_ERROR", "Malformed encrypted payload");
    }
    const [, version, ivB64, tagB64, dataB64] = parts;
    const key = version === keyring.version ? keyring.active : keyring.previous;
    if (!key) {
        throw new errors_1.AppError("INTERNAL_ERROR", `No key available to decrypt version ${version}`);
    }
    try {
        const decipher = (0, node_crypto_1.createDecipheriv)(ALGO, key, Buffer.from(ivB64, "base64url"), {
            authTagLength: AUTH_TAG_LENGTH,
        });
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
        return Buffer.concat([
            decipher.update(Buffer.from(dataB64, "base64url")),
            decipher.final(),
        ]).toString("utf8");
    }
    catch {
        throw new errors_1.AppError("INTERNAL_ERROR", "Failed to decrypt field");
    }
};
exports.decryptField = decryptField;
/**
 * Keyed HMAC for deterministic lookups (phone/email/registration).
 * A database leak must not allow reversing these to plaintext without
 * LOOKUP_HMAC_KEY, and unsalted hashes of phone numbers are trivially
 * brute-forced, hence a keyed HMAC with a dedicated per-category context.
 */
const lookupHmac = (value, context = "default") => (0, node_crypto_1.createHmac)("sha256", config_1.env.LOOKUP_HMAC_KEY)
    .update(`${context}:${normalizeLookupValue(value)}`)
    .digest("hex");
exports.lookupHmac = lookupHmac;
/**
 * Canonicalise a phone number to E.164 so the same human number always maps to
 * the same lookup HMAC. Accepts local Indian numbers (`9876543210`), numbers
 * with a trunk prefix (`09876543210`), country-coded numbers (`919876543210`)
 * and already-international numbers (`+14155551234`).
 */
const normalizePhone = (phone) => {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, "");
    if (trimmed.startsWith("+"))
        return `+${digits}`;
    if (digits.length === 10)
        return `+91${digits}`;
    if (digits.length === 11 && digits.startsWith("0"))
        return `+91${digits.slice(1)}`;
    if (digits.length === 12 && digits.startsWith("91"))
        return `+${digits}`;
    return `+${digits}`;
};
exports.normalizePhone = normalizePhone;
const normalizeEmail = (email) => email.trim().toLowerCase();
exports.normalizeEmail = normalizeEmail;
const normalizeRegistration = (reg) => reg.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
exports.normalizeRegistration = normalizeRegistration;
const normalizeLookupValue = (value) => {
    const v = value.trim();
    if (/^91\d{10}$/.test(v.replace(/\D/g, "")) || /^\d{10}$/.test(v.replace(/\D/g, ""))) {
        return (0, exports.normalizePhone)(v);
    }
    if (v.includes("@"))
        return (0, exports.normalizeEmail)(v);
    return v.toUpperCase();
};
const maskPhone = (phone) => {
    const digits = (0, exports.normalizePhone)(phone).replace(/\D/g, "");
    return `+91 ${digits.slice(2, 6)}****${digits.slice(-2)}`;
};
exports.maskPhone = maskPhone;
const maskRegistration = (reg) => {
    const r = reg.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return r.length <= 4 ? r : `${"*".repeat(Math.max(0, r.length - 4))}${r.slice(-4)}`;
};
exports.maskRegistration = maskRegistration;
const randomToken = (bytes = 32) => (0, node_crypto_1.randomBytes)(bytes).toString("base64url");
exports.randomToken = randomToken;
const randomOtp = (digits = 6) => {
    const max = 10 ** digits;
    let value = (0, node_crypto_1.randomBytes)(4).readUInt32BE(0) % max;
    value = Number(value.toString().padStart(digits, "0"));
    return value.toString().padStart(digits, "0");
};
exports.randomOtp = randomOtp;
const sha256 = (value) => (0, node_crypto_1.createHmac)("sha256", config_1.env.LOOKUP_HMAC_KEY).update(value).digest("hex");
exports.sha256 = sha256;
const safeEqual = (a, b) => {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length)
        return false;
    return (0, node_crypto_1.timingSafeEqual)(bufA, bufB);
};
exports.safeEqual = safeEqual;
/**
 * Public tag tokens are random, high-entropy and stored hashed, so a leaked
 * database cannot be walked to enumerate live tags.
 */
const generatePublicTagToken = () => {
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
    const bytes = (0, node_crypto_1.randomBytes)(24);
    let out = "";
    for (let i = 0; i < 24; i++)
        out += alphabet[bytes[i] % alphabet.length];
    return out;
};
exports.generatePublicTagToken = generatePublicTagToken;
exports.MASKED_PLACEHOLDER = "+91 XXXXXX0000";
//# sourceMappingURL=crypto.js.map