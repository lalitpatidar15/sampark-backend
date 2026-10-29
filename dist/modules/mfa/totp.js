"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeTOTP = computeTOTP;
exports.verifyTOTP = verifyTOTP;
exports.generateTotpSecret = generateTotpSecret;
exports.buildTotpUri = buildTotpUri;
const node_crypto_1 = require("node:crypto");
/**
 * TOTP (RFC 6238) helpers implemented with Node crypto only — no external
 * dependency. Used for admin step-up MFA.
 *
 * Time step: 30 seconds. Algorithm: SHA-1 (6-digit code).
 */
/** Base32 alphabet (RFC 4648). */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(bytes) {
    let bits = 0;
    let bitCount = 0;
    let out = "";
    for (const b of bytes) {
        bits = (bits << 8) | b;
        bitCount += 8;
        while (bitCount >= 5) {
            bitCount -= 5;
            out += BASE32_ALPHABET[(bits >> bitCount) & 31];
        }
    }
    if (bitCount > 0) {
        out += BASE32_ALPHABET[(bits << (5 - bitCount)) & 31];
    }
    // Pad to a multiple of 8 characters.
    while (out.length % 8 !== 0)
        out += "=";
    return out;
}
function base32Decode(input) {
    const cleaned = input.replace(/[=]/g, "").toUpperCase();
    let bits = 0;
    let bitCount = 0;
    const out = [];
    for (const ch of cleaned) {
        const val = BASE32_ALPHABET.indexOf(ch);
        if (val === -1)
            throw new Error("Invalid base32 character");
        bits = (bits << 5) | val;
        bitCount += 5;
        if (bitCount >= 8) {
            bitCount -= 8;
            out.push((bits >> bitCount) & 0xff);
        }
    }
    return new Uint8Array(out);
}
const TOTP_STEP = 30;
const TOTP_DIGITS = 6;
function computeHOTP(key, counter) {
    const counterBuf = Buffer.alloc(8);
    for (let i = 7; i >= 0; i--) {
        counterBuf[i] = counter & 0xff;
        counter = counter >>> 8;
    }
    const hmac = (0, node_crypto_1.createHmac)("sha1", key).update(counterBuf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary = ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
    const otp = (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
    return otp;
}
function computeTOTP(keyBase32, timeStepSeconds = TOTP_STEP) {
    const key = base32Decode(keyBase32);
    const counter = Math.floor(Date.now() / 1000 / timeStepSeconds);
    return computeHOTP(key, counter);
}
function verifyTOTP(token, keyBase32, window = 1) {
    const key = base32Decode(keyBase32);
    const now = Math.floor(Date.now() / 1000 / TOTP_STEP);
    for (let offset = -window; offset <= window; offset++) {
        const otp = computeHOTP(key, now + offset);
        if ((0, node_crypto_1.timingSafeEqual)(Buffer.from(token), Buffer.from(otp)))
            return true;
    }
    return false;
}
function generateTotpSecret(lengthBytes = 20) {
    return base32Encode((0, node_crypto_1.randomBytes)(lengthBytes));
}
function buildTotpUri(secret, accountName, issuer = "Sampark") {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(accountName);
    return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&digits=6&period=30`;
}
//# sourceMappingURL=totp.js.map