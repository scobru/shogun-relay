/**
 * x402 Payment Verification Tests
 *
 * Tests for payment verification logic used in x402 subscriptions.
 * Critical for ensuring payment security.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

// Types matching x402 specification
interface PaymentAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    authorization: PaymentAuthorization;
    signature: string;
  };
}

interface SubscriptionTier {
  name: string;
  priceUSDC: number;
  storageMB: number;
  durationDays: number;
}

describe("x402 Payment Verification", () => {
  // Test configuration
  const RELAY_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const USER_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

  // USDC has 6 decimals
  const USDC_DECIMALS = 6;
  const parseUSDC = (amount: string | number): bigint => {
    return BigInt(Math.floor(Number(amount) * 10 ** USDC_DECIMALS));
  };

  const SUBSCRIPTION_TIERS: Record<string, SubscriptionTier> = {
    basic: { name: "Basic", priceUSDC: 0.001, storageMB: 100, durationDays: 30 },
    standard: { name: "Standard", priceUSDC: 0.004, storageMB: 500, durationDays: 30 },
    premium: { name: "Premium", priceUSDC: 0.01, storageMB: 2000, durationDays: 30 },
  };

  describe("Payment Amount Validation", () => {
    it("should validate correct payment amounts", () => {
      const validateAmount = (
        paidAmount: bigint,
        tier: string
      ): { valid: boolean; error?: string } => {
        const tierInfo = SUBSCRIPTION_TIERS[tier.toLowerCase()];
        if (!tierInfo) {
          return { valid: false, error: "Invalid tier" };
        }

        const requiredAmount = parseUSDC(tierInfo.priceUSDC);
        if (paidAmount < requiredAmount) {
          return {
            valid: false,
            error: `Insufficient payment: ${paidAmount} < ${requiredAmount}`,
          };
        }

        return { valid: true };
      };

      // Exact amount
      expect(validateAmount(parseUSDC(0.001), "basic").valid).toBe(true);

      // Overpayment (should be valid)
      expect(validateAmount(parseUSDC(0.002), "basic").valid).toBe(true);

      // Underpayment
      expect(validateAmount(parseUSDC(0.0005), "basic").valid).toBe(false);

      // Zero amount
      expect(validateAmount(BigInt(0), "basic").valid).toBe(false);
    });

    it("should handle USDC decimal precision", () => {
      // USDC has 6 decimals
      const oneUSDC = BigInt(1_000_000);
      const oneCent = BigInt(10_000);
      const oneMill = BigInt(1_000); // 0.001 USDC

      expect(oneUSDC).toBe(parseUSDC(1));
      expect(oneCent).toBe(parseUSDC(0.01));
      expect(oneMill).toBe(parseUSDC(0.001));
    });
  });

  describe("Recipient Validation", () => {
    it("should validate correct recipient", () => {
      const validateRecipient = (paymentTo: string, expectedRecipient: string): boolean => {
        return (
          ethers.getAddress(paymentTo).toLowerCase() ===
          ethers.getAddress(expectedRecipient).toLowerCase()
        );
      };

      expect(validateRecipient(RELAY_ADDRESS, RELAY_ADDRESS)).toBe(true);
      expect(validateRecipient(RELAY_ADDRESS.toLowerCase(), RELAY_ADDRESS)).toBe(true);

      // Wrong recipient
      expect(validateRecipient(USER_ADDRESS, RELAY_ADDRESS)).toBe(false);
    });

    it("should reject invalid addresses", () => {
      const validateRecipient = (paymentTo: string): boolean => {
        try {
          ethers.getAddress(paymentTo);
          return true;
        } catch {
          return false;
        }
      };

      expect(validateRecipient("0xinvalid")).toBe(false);
      expect(validateRecipient("")).toBe(false);
    });
  });

  describe("Time Window Validation", () => {
    it("should validate payment is within time window", () => {
      const validateTimeWindow = (
        validAfter: number,
        validBefore: number,
        now: number
      ): { valid: boolean; error?: string } => {
        if (now < validAfter) {
          return { valid: false, error: "Payment not yet valid" };
        }
        if (now >= validBefore) {
          return { valid: false, error: "Payment expired" };
        }
        return { valid: true };
      };

      const now = Math.floor(Date.now() / 1000);
      const fiveMinutesAgo = now - 300;
      const fiveMinutesLater = now + 300;

      // Valid window
      expect(validateTimeWindow(fiveMinutesAgo, fiveMinutesLater, now).valid).toBe(true);

      // Not yet valid
      expect(validateTimeWindow(fiveMinutesLater, fiveMinutesLater + 600, now).valid).toBe(false);

      // Already expired
      expect(validateTimeWindow(fiveMinutesAgo - 600, fiveMinutesAgo, now).valid).toBe(false);
    });

    it("should handle edge cases at boundaries", () => {
      const validateTimeWindow = (
        validAfter: number,
        validBefore: number,
        now: number
      ): boolean => {
        return now >= validAfter && now < validBefore;
      };

      const now = 1000;

      // Exactly at validAfter
      expect(validateTimeWindow(1000, 2000, 1000)).toBe(true);

      // Exactly at validBefore
      expect(validateTimeWindow(1000, 2000, 2000)).toBe(false);

      // One second before validBefore
      expect(validateTimeWindow(1000, 2000, 1999)).toBe(true);
    });
  });

  describe("Nonce Validation", () => {
    it("should validate unique nonce", () => {
      const usedNonces = new Set<string>();

      const validateNonce = (nonce: string): boolean => {
        if (usedNonces.has(nonce)) {
          return false;
        }
        usedNonces.add(nonce);
        return true;
      };

      const nonce1 = ethers.hexlify(ethers.randomBytes(32));
      const nonce2 = ethers.hexlify(ethers.randomBytes(32));

      // First use should pass
      expect(validateNonce(nonce1)).toBe(true);

      // Second use should fail (replay)
      expect(validateNonce(nonce1)).toBe(false);

      // Different nonce should pass
      expect(validateNonce(nonce2)).toBe(true);
    });

    it("should generate valid random nonces", () => {
      const generateNonce = (): string => {
        return ethers.hexlify(ethers.randomBytes(32));
      };

      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      // Should be valid hex
      expect(nonce1).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Should be unique
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe("Full Payment Verification", () => {
    interface VerificationResult {
      isValid: boolean;
      invalidReason?: string;
      payer?: string;
      amount?: string;
      tier?: string;
    }

    const verifyPayment = (
      payment: PaymentPayload,
      tier: string,
      expectedRecipient: string,
      now: number,
      usedNonces: Set<string>
    ): VerificationResult => {
      // Check version
      if (payment.x402Version !== 1) {
        return { isValid: false, invalidReason: "Invalid x402 version" };
      }

      // Check scheme
      if (payment.scheme !== "exact") {
        return { isValid: false, invalidReason: "Invalid payment scheme" };
      }

      const auth = payment.payload.authorization;

      // Validate recipient
      try {
        if (
          ethers.getAddress(auth.to).toLowerCase() !==
          ethers.getAddress(expectedRecipient).toLowerCase()
        ) {
          return { isValid: false, invalidReason: "Invalid recipient" };
        }
      } catch {
        return { isValid: false, invalidReason: "Invalid recipient address" };
      }

      // Validate amount
      const tierInfo = SUBSCRIPTION_TIERS[tier.toLowerCase()];
      if (!tierInfo) {
        return { isValid: false, invalidReason: "Invalid tier" };
      }

      const paidAmount = BigInt(auth.value);
      const requiredAmount = parseUSDC(tierInfo.priceUSDC);
      if (paidAmount < requiredAmount) {
        return { isValid: false, invalidReason: "Insufficient payment" };
      }

      // Validate time window
      const validAfter = parseInt(auth.validAfter);
      const validBefore = parseInt(auth.validBefore);
      if (now < validAfter) {
        return { isValid: false, invalidReason: "Payment not yet valid" };
      }
      if (now >= validBefore) {
        return { isValid: false, invalidReason: "Payment expired" };
      }

      // Validate nonce
      if (usedNonces.has(auth.nonce)) {
        return { isValid: false, invalidReason: "Nonce already used" };
      }

      // Payment is valid
      usedNonces.add(auth.nonce);
      return {
        isValid: true,
        payer: auth.from,
        amount: auth.value,
        tier,
      };
    };

    it("should accept valid payment", () => {
      const now = Math.floor(Date.now() / 1000);
      const usedNonces = new Set<string>();

      const payment: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "base-sepolia",
        payload: {
          authorization: {
            from: USER_ADDRESS,
            to: RELAY_ADDRESS,
            value: parseUSDC(0.001).toString(),
            validAfter: (now - 300).toString(),
            validBefore: (now + 300).toString(),
            nonce: ethers.hexlify(ethers.randomBytes(32)),
          },
          signature: "0x" + "0".repeat(130), // Mock signature
        },
      };

      const result = verifyPayment(payment, "basic", RELAY_ADDRESS, now, usedNonces);
      expect(result.isValid).toBe(true);
      expect(result.payer).toBe(USER_ADDRESS);
    });

    it("should reject payment to wrong recipient", () => {
      const now = Math.floor(Date.now() / 1000);
      const usedNonces = new Set<string>();

      const payment: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "base-sepolia",
        payload: {
          authorization: {
            from: USER_ADDRESS,
            to: "0x1111111111111111111111111111111111111111", // Wrong recipient
            value: parseUSDC(0.001).toString(),
            validAfter: (now - 300).toString(),
            validBefore: (now + 300).toString(),
            nonce: ethers.hexlify(ethers.randomBytes(32)),
          },
          signature: "0x" + "0".repeat(130),
        },
      };

      const result = verifyPayment(payment, "basic", RELAY_ADDRESS, now, usedNonces);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("Invalid recipient");
    });

    it("should reject insufficient payment", () => {
      const now = Math.floor(Date.now() / 1000);
      const usedNonces = new Set<string>();

      const payment: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "base-sepolia",
        payload: {
          authorization: {
            from: USER_ADDRESS,
            to: RELAY_ADDRESS,
            value: parseUSDC(0.0001).toString(), // Too little
            validAfter: (now - 300).toString(),
            validBefore: (now + 300).toString(),
            nonce: ethers.hexlify(ethers.randomBytes(32)),
          },
          signature: "0x" + "0".repeat(130),
        },
      };

      const result = verifyPayment(payment, "basic", RELAY_ADDRESS, now, usedNonces);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("Insufficient payment");
    });

    it("should reject expired payment", () => {
      const now = Math.floor(Date.now() / 1000);
      const usedNonces = new Set<string>();

      const payment: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "base-sepolia",
        payload: {
          authorization: {
            from: USER_ADDRESS,
            to: RELAY_ADDRESS,
            value: parseUSDC(0.001).toString(),
            validAfter: (now - 600).toString(),
            validBefore: (now - 300).toString(), // Already expired
            nonce: ethers.hexlify(ethers.randomBytes(32)),
          },
          signature: "0x" + "0".repeat(130),
        },
      };

      const result = verifyPayment(payment, "basic", RELAY_ADDRESS, now, usedNonces);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe("Payment expired");
    });

    it("should reject replayed nonce", () => {
      const now = Math.floor(Date.now() / 1000);
      const usedNonces = new Set<string>();
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      const payment: PaymentPayload = {
        x402Version: 1,
        scheme: "exact",
        network: "base-sepolia",
        payload: {
          authorization: {
            from: USER_ADDRESS,
            to: RELAY_ADDRESS,
            value: parseUSDC(0.001).toString(),
            validAfter: (now - 300).toString(),
            validBefore: (now + 300).toString(),
            nonce,
          },
          signature: "0x" + "0".repeat(130),
        },
      };

      // First payment succeeds
      const result1 = verifyPayment(payment, "basic", RELAY_ADDRESS, now, usedNonces);
      expect(result1.isValid).toBe(true);

      // Replay fails
      const result2 = verifyPayment(payment, "basic", RELAY_ADDRESS, now, usedNonces);
      expect(result2.isValid).toBe(false);
      expect(result2.invalidReason).toBe("Nonce already used");
    });
  });

  describe("Subscription Tier Calculations", () => {
    it("should calculate correct expiration date", () => {
      const calculateExpiration = (purchaseTimestamp: number, durationDays: number): number => {
        return purchaseTimestamp + durationDays * 24 * 60 * 60 * 1000;
      };

      const now = Date.now();
      const tier = SUBSCRIPTION_TIERS.basic;

      const expiration = calculateExpiration(now, tier.durationDays);
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      expect(expiration - now).toBe(thirtyDaysMs);
    });

    it("should check if subscription is active", () => {
      const isSubscriptionActive = (expiresAt: number, now: number): boolean => {
        return expiresAt > now;
      };

      const now = Date.now();

      // Active subscription
      expect(isSubscriptionActive(now + 1000, now)).toBe(true);

      // Expired subscription
      expect(isSubscriptionActive(now - 1000, now)).toBe(false);

      // Exactly expired
      expect(isSubscriptionActive(now, now)).toBe(false);
    });

    it("should calculate remaining storage", () => {
      const calculateRemainingStorage = (storageMB: number, storageUsedMB: number): number => {
        return Math.max(0, storageMB - storageUsedMB);
      };

      // Normal usage
      expect(calculateRemainingStorage(100, 50)).toBe(50);

      // Full usage
      expect(calculateRemainingStorage(100, 100)).toBe(0);

      // Over usage (shouldn't happen but handle gracefully)
      expect(calculateRemainingStorage(100, 150)).toBe(0);
    });
  });
});
