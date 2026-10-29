import { authService } from '../src/modules/auth/auth.service';
import { tagService, CONTACT_REASONS } from '../src/modules/tags/tag.service';
import { vehicleService } from '../src/modules/vehicles/vehicle.service';
import { communicationService } from '../src/modules/communication/communication.service';
import { scannerService } from '../src/modules/scanner/scanner.service';
import { generatePublicTagToken, sha256, encryptField, decryptField, lookupHmac, normalizePhone, normalizeRegistration } from '../src/common/utils/crypto';

describe('Crypto Utilities', () => {
  describe('sha256', () => {
    it('should produce consistent hashes', () => {
      const input = 'test-string';
      const hash1 = sha256(input);
      const hash2 = sha256(input);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should produce different hashes for different inputs', () => {
      expect(sha256('a')).not.toBe(sha256('b'));
    });
  });

  describe('lookupHmac', () => {
    it('should produce consistent HMACs for same input', () => {
      const input = 'test-phone';
      const hmac1 = lookupHmac(input, 'phone');
      const hmac2 = lookupHmac(input, 'phone');
      expect(hmac1).toBe(hmac2);
    });

    it('should produce different HMACs for different contexts', () => {
      const input = 'same-value';
      const phoneHmac = lookupHmac(input, 'phone');
      const emailHmac = lookupHmac(input, 'email');
      expect(phoneHmac).not.toBe(emailHmac);
    });
  });

  describe('normalizePhone', () => {
    it('should normalize Indian phone numbers', () => {
      expect(normalizePhone('9876543210')).toBe('+919876543210');
      expect(normalizePhone('+919876543210')).toBe('+919876543210');
      expect(normalizePhone('09876543210')).toBe('+919876543210');
    });

    it('should handle international numbers', () => {
      expect(normalizePhone('+14155551234')).toBe('+14155551234');
    });
  });

  describe('normalizeRegistration', () => {
    it('should normalize vehicle registrations', () => {
      expect(normalizeRegistration('MH 12 AB 1234')).toBe('MH12AB1234');
      expect(normalizeRegistration('mh12ab1234')).toBe('MH12AB1234');
      expect(normalizeRegistration('MH-12-AB-1234')).toBe('MH12AB1234');
    });
  });

  describe('encryptField / decryptField', () => {
    it('should encrypt and decrypt correctly', () => {
      const original = 'sensitive-data-123';
      const encrypted = encryptField(original, 'phone');
      const decrypted = decryptField(encrypted, 'phone');
      expect(decrypted).toBe(original);
      expect(encrypted).not.toBe(original);
    });

    it('should produce different ciphertexts for same plaintext', () => {
      const original = 'test-data';
      const encrypted1 = encryptField(original, 'phone');
      const encrypted2 = encryptField(original, 'phone');
      expect(encrypted1).not.toBe(encrypted2);
    });
  });
});

describe('Auth Service', () => {
  it('should export auth service functions', () => {
    expect(authService.requestOtp).toBeDefined();
    expect(authService.verifyPhoneOtp).toBeDefined();
    expect(authService.login).toBeDefined();
    expect(authService.refresh).toBeDefined();
    expect(authService.logout).toBeDefined();
    expect(authService.logoutAll).toBeDefined();
    expect(authService.me).toBeDefined();
    expect(authService.reauthenticate).toBeDefined();
  });
});

describe('Tag Service', () => {
  it('should export tag service functions', () => {
    expect(tagService.createTag).toBeDefined();
    expect(tagService.listTags).toBeDefined();
    expect(tagService.activateTag).toBeDefined();
    expect(tagService.deactivateTag).toBeDefined();
    expect(tagService.rotateToken).toBeDefined();
    expect(tagService.publicTokenForOwner).toBeDefined();
    expect(tagService.linkNfc).toBeDefined();
    expect(tagService.linkAsset).toBeDefined();
    expect(tagService.history).toBeDefined();
    expect(tagService.resolveForScanner).toBeDefined();
    expect(tagService.qrPayloadFor).toBeDefined();
    expect(tagService.reasonIsAllowed).toBeDefined();
  });

  describe('CONTACT_REASONS', () => {
    it('should have expected reasons', () => {
      expect(CONTACT_REASONS).toHaveLength(8);
      const codes = CONTACT_REASONS.map(r => r.code);
      expect(codes).toContain('VEHICLE_NEEDS_ATTENTION');
      expect(codes).toContain('LIGHTS_ON');
      expect(codes).toContain('BLOCKING');
      expect(codes).toContain('ACCIDENT_EMERGENCY');
      expect(codes).toContain('DELIVERY');
      expect(codes).toContain('PROFESSIONAL_ENQUIRY');
      expect(codes).toContain('PARKING_DISPUTE');
      expect(codes).toContain('OTHER');
    });
  });

  describe('reasonIsAllowed', () => {
    it('should allow OTHER for any asset type', () => {
      expect(tagService.reasonIsAllowed('OTHER', 'VEHICLE')).toBe(true);
      expect(tagService.reasonIsAllowed('OTHER', null)).toBe(true);
    });

    it('should filter reasons by asset type', () => {
      expect(tagService.reasonIsAllowed('VEHICLE_NEEDS_ATTENTION', 'VEHICLE')).toBe(true);
      expect(tagService.reasonIsAllowed('VEHICLE_NEEDS_ATTENTION', 'HOME_DOOR')).toBe(false);
    });
  });
});

describe('Vehicle Service', () => {
  it('should export vehicle service functions', () => {
    expect(vehicleService.createVehicle).toBeDefined();
    expect(vehicleService.listVehicles).toBeDefined();
    expect(vehicleService.updateVehicle).toBeDefined();
    expect(vehicleService.deleteVehicle).toBeDefined();
    expect(vehicleService.activity).toBeDefined();
    expect(vehicleService.recordEvent).toBeDefined();
    expect(vehicleService.searchRegistration).toBeDefined();
  });
});

describe('Scanner Service', () => {
  it('should export scanner service functions', () => {
    expect(scannerService.resolveTag).toBeDefined();
    expect(scannerService.createSession).toBeDefined();
    expect(scannerService.authorizeSession).toBeDefined();
    expect(scannerService.setReason).toBeDefined();
    expect(scannerService.verifyScannerPhone).toBeDefined();
    expect(scannerService.assertNotRateLimited).toBeDefined();
    expect(scannerService.assertSessionActionBudget).toBeDefined();
    expect(scannerService.scoreRisk).toBeDefined();
    expect(scannerService.requiresOtp).toBeDefined();
  });

  describe('scoreRisk', () => {
    it('should return LOW for normal requests', () => {
      const result = scannerService.scoreRisk({ ip: '192.168.1.1', userAgent: 'Mozilla/5.0', phoneVerified: false });
      expect(result.state).toBe('LOW');
      expect(result.score).toBeLessThan(30);
    });

    it('should return HIGH for suspicious user agents', () => {
      const result = scannerService.scoreRisk({ ip: '192.168.1.1', userAgent: 'curl/7.68.0', phoneVerified: false });
      expect(result.state).toBe('HIGH');
      expect(result.score).toBeGreaterThanOrEqual(60);
    });

    it('should lower risk for verified phones', () => {
      const result = scannerService.scoreRisk({ ip: '192.168.1.1', userAgent: 'curl/7.68.0', phoneVerified: true });
      expect(result.score).toBeLessThan(60);
    });
  });

  describe('requiresOtp', () => {
    it('should require OTP for HIGH risk state', () => {
      expect(scannerService.requiresOtp({ riskState: 'HIGH', phoneVerified: false, riskScore: 80 })).toBe(true);
    });

    it('should not require OTP if phone verified', () => {
      expect(scannerService.requiresOtp({ riskState: 'HIGH', phoneVerified: true, riskScore: 80 })).toBe(false);
    });

    it('should not require OTP for LOW risk', () => {
      expect(scannerService.requiresOtp({ riskState: 'LOW', phoneVerified: false, riskScore: 10 })).toBe(false);
    });
  });
});

describe('Communication Service', () => {
  it('should export communication service functions', () => {
    expect(communicationService.startFromScanner).toBeDefined();
    expect(communicationService.dispatch).toBeDefined();
    expect(communicationService.toScannerView).toBeDefined();
    expect(communicationService.listForOwner).toBeDefined();
    expect(communicationService.reply).toBeDefined();
    expect(communicationService.sendFromScanner).toBeDefined();
    expect(communicationService.messages).toBeDefined();
    expect(communicationService.raiseEmergency).toBeDefined();
    expect(communicationService.scannerStatus).toBeDefined();
    expect(communicationService.endScannerSession).toBeDefined();
  });
});

describe('Token Generation', () => {
  it('should generate public tag tokens', () => {
    const token1 = generatePublicTagToken();
    const token2 = generatePublicTagToken();
    expect(token1).not.toBe(token2);
    expect(token1.length).toBeGreaterThan(20);
  });
});