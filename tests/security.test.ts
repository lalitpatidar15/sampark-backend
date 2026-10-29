import { describe, it, expect } from "vitest";
import {
  encryptField,
  decryptField,
  lookupHmac,
  normalizePhone,
  normalizeRegistration,
  randomToken,
} from "../src/common/utils/crypto";
import { verifyTOTP, generateTotpSecret, buildTotpUri, computeTOTP } from "../src/modules/mfa/totp";
import { scannerService } from "../src/modules/scanner/scanner.service";

describe("Security: Field Encryption", () => {
  it("should encrypt and decrypt round-trip", () => {
    const plaintext = "+919876543210 sensitive-data";
    const encrypted = encryptField(plaintext, "phone");
    expect(encrypted).not.toBe(plaintext);
    expect(decryptField(encrypted, "phone")).toBe(plaintext);
  });

  it("should produce different ciphertexts for identical plaintext (IV randomization)", () => {
    const plaintext = "same-phone-number";
    const e1 = encryptField(plaintext, "phone");
    const e2 = encryptField(plaintext, "phone");
    expect(e1).not.toBe(e2);
    expect(decryptField(e1, "phone")).toBe(plaintext);
    expect(decryptField(e2, "phone")).toBe(plaintext);
  });

  it("should not decrypt with wrong context", () => {
    const encrypted = encryptField("data", "phone");
    expect(() => decryptField(encrypted, "email")).toThrow();
  });
});

describe("Security: HMAC Lookup (no raw PII leakage)", () => {
  it("should produce consistent HMACs", () => {
    expect(lookupHmac("+919876543210", "phone")).toBe(lookupHmac("+919876543210", "phone"));
  });

  it("should be context-separated", () => {
    expect(lookupHmac("value", "phone")).not.toBe(lookupHmac("value", "email"));
  });

  it("should not be reversible / is fixed length", () => {
    const hmac = lookupHmac("+919876543210", "phone");
    expect(hmac).toHaveLength(64); // sha256 hex
    expect(hmac).not.toBe("+919876543210");
  });
});

describe("Security: Phone Normalization", () => {
  it("should canonicalize Indian numbers to E.164", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("+919876543210")).toBe("+919876543210");
    expect(normalizePhone("09876543210")).toBe("+919876543210");
  });

  it("should preserve international E.164", () => {
    expect(normalizePhone("+14155551234")).toBe("+14155551234");
  });
});

describe("Security: Registration Normalization", () => {
  it("should strip formatting and uppercase", () => {
    expect(normalizeRegistration("MH 12 AB 1234")).toBe("MH12AB1234");
    expect(normalizeRegistration("mh-12-ab-1234")).toBe("MH12AB1234");
  });
});

describe("Security: Random Tokens", () => {
  it("should produce high-entropy unique tokens", () => {
    const t1 = randomToken(32);
    const t2 = randomToken(32);
    expect(t1.length).toBeGreaterThan(20);
    expect(t1).not.toBe(t2);
    expect(/^[A-Za-z0-9_-]+$/.test(t1)).toBe(true);
  });
});

describe("Security: TOTP (RFC 6238)", () => {
  it("should verify a freshly computed code", () => {
    const secret = generateTotpSecret();
    const code = computeTOTP(secret);
    expect(verifyTOTP(code, secret, 1)).toBe(true);
  });

  it("should reject a wrong code", () => {
    const secret = generateTotpSecret();
    expect(verifyTOTP("000000", secret, 1)).toBe(false);
  });

  it("should build a valid provisioning URI", () => {
    const uri = buildTotpUri("JBSWY3DPEHPK3PXP", "alice@example.com", "Sampark");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Sampark");
  });
});

describe("Security: Risk Scoring", () => {
  it("should return LOW for normal requests", () => {
    const result = scannerService.scoreRisk({ ip: "192.168.1.1", userAgent: "Mozilla/5.0", phoneVerified: false });
    expect(result.state).toBe("LOW");
    expect(result.score).toBeLessThan(30);
  });

  it("should return HIGH for suspicious user agents", () => {
    const result = scannerService.scoreRisk({ ip: "192.168.1.1", userAgent: "curl/7.68.0", phoneVerified: false });
    expect(result.state).toBe("HIGH");
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it("should lower risk for verified phones", () => {
    const suspicious = scannerService.scoreRisk({ ip: "192.168.1.1", userAgent: "curl/7.68.0", phoneVerified: false });
    const verified = scannerService.scoreRisk({ ip: "192.168.1.1", userAgent: "curl/7.68.0", phoneVerified: true });
    expect(verified.score).toBeLessThan(suspicious.score);
  });
});
