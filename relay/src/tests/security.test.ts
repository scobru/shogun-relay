/**
 * Security Utilities Tests
 *
 * Tests for security-related utilities like rate limiting,
 * user locking, and input validation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ethers } from "ethers";

describe("Security Utilities", () => {
  describe("Address Validation", () => {
    it("should accept valid checksummed addresses", () => {
      const validAddresses = [
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      ];

      for (const addr of validAddresses) {
        expect(ethers.isAddress(addr)).toBe(true);
        expect(() => ethers.getAddress(addr)).not.toThrow();
      }
    });

    it("should accept valid lowercase addresses", () => {
      const addr = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
      expect(ethers.isAddress(addr)).toBe(true);

      // getAddress should return checksummed version
      const checksummed = ethers.getAddress(addr);
      expect(checksummed).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    });

    it("should reject invalid addresses", () => {
      const invalidAddresses = [
        "0x123", // Too short
        "not-an-address",
        "0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", // Invalid hex
        "", // Empty
        "0x" + "0".repeat(41), // Too long
      ];

      for (const addr of invalidAddresses) {
        expect(ethers.isAddress(addr)).toBe(false);
      }
    });

    it("should handle null/undefined gracefully", () => {
      expect(ethers.isAddress(null as unknown as string)).toBe(false);
      expect(ethers.isAddress(undefined as unknown as string)).toBe(false);
    });
  });

  describe("Amount Validation", () => {
    it("should parse valid ETH amounts", () => {
      const testCases = [
        { input: "1.0", expected: BigInt("1000000000000000000") },
        { input: "0.5", expected: BigInt("500000000000000000") },
        { input: "0.001", expected: BigInt("1000000000000000") },
        { input: "100", expected: BigInt("100000000000000000000") },
      ];

      for (const { input, expected } of testCases) {
        const parsed = ethers.parseEther(input);
        expect(parsed).toBe(expected);
      }
    });

    it("should handle wei amounts", () => {
      const wei = BigInt("1234567890123456789");
      const formatted = ethers.formatEther(wei);
      const parsed = ethers.parseEther(formatted);

      // Due to precision, parsed might differ slightly
      expect(parsed).toBe(wei);
    });

    it("should handle negative amounts", () => {
      // In ethers v6, parseEther accepts negative values
      const negative = ethers.parseEther("-1");
      expect(negative).toBe(BigInt("-1000000000000000000"));
    });

    it("should handle zero amount", () => {
      const zero = ethers.parseEther("0");
      expect(zero).toBe(BigInt(0));
    });

    it("should handle very large amounts", () => {
      const large = ethers.parseEther("1000000000"); // 1 billion ETH
      expect(large).toBe(BigInt("1000000000000000000000000000"));
    });

    it("should handle very small amounts", () => {
      const small = ethers.parseEther("0.000000000000000001"); // 1 wei
      expect(small).toBe(BigInt(1));
    });
  });

  describe("Nonce Validation", () => {
    it("should accept valid nonces", () => {
      const validNonces = [BigInt(0), BigInt(1), BigInt(1000), BigInt("9999999999999")];

      for (const nonce of validNonces) {
        expect(nonce >= BigInt(0)).toBe(true);
      }
    });

    it("should validate nonce is incremental", () => {
      let lastNonce = BigInt(0);

      const validateNonce = (newNonce: bigint): boolean => {
        return newNonce > lastNonce;
      };

      expect(validateNonce(BigInt(1))).toBe(true);
      lastNonce = BigInt(1);

      expect(validateNonce(BigInt(2))).toBe(true);
      expect(validateNonce(BigInt(1))).toBe(false); // Reused nonce
      expect(validateNonce(BigInt(0))).toBe(false); // Old nonce
    });
  });

  describe("Signature Validation", () => {
    it("should verify message signature", async () => {
      const wallet = ethers.Wallet.createRandom();
      const message = "Hello, World!";

      const signature = await wallet.signMessage(message);

      // Recover the signer
      const recoveredAddress = ethers.verifyMessage(message, signature);
      expect(recoveredAddress.toLowerCase()).toBe(wallet.address.toLowerCase());
    });

    it("should reject tampered message", async () => {
      const wallet = ethers.Wallet.createRandom();
      const message = "Original message";

      const signature = await wallet.signMessage(message);

      // Verify with different message should fail
      const recoveredAddress = ethers.verifyMessage("Tampered message", signature);
      expect(recoveredAddress.toLowerCase()).not.toBe(wallet.address.toLowerCase());
    });

    it("should handle typed data signature (EIP-712)", async () => {
      const wallet = ethers.Wallet.createRandom();

      const domain = {
        name: "Test",
        version: "1",
        chainId: 1,
      };

      const types = {
        Withdrawal: [
          { name: "user", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      };

      const value = {
        user: wallet.address,
        amount: ethers.parseEther("1"),
        nonce: 1,
      };

      const signature = await wallet.signTypedData(domain, types, value);
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);

      // Verify the signature
      const recoveredAddress = ethers.verifyTypedData(domain, types, value, signature);
      expect(recoveredAddress.toLowerCase()).toBe(wallet.address.toLowerCase());
    });
  });

  describe("Hash Functions", () => {
    it("should compute keccak256 correctly", () => {
      const data = "0x1234";
      const hash = ethers.keccak256(data);

      expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // Same input should always produce same hash
      expect(ethers.keccak256(data)).toBe(hash);
    });

    it("should produce unique hashes for different inputs", () => {
      const hash1 = ethers.keccak256("0x1234");
      const hash2 = ethers.keccak256("0x1235");

      expect(hash1).not.toBe(hash2);
    });

    it("should handle solidityPacked encoding", () => {
      const encoded = ethers.solidityPacked(
        ["address", "uint256"],
        ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 1000]
      );

      expect(encoded).toMatch(/^0x[a-fA-F0-9]+$/);

      // Should be deterministic
      const encoded2 = ethers.solidityPacked(
        ["address", "uint256"],
        ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 1000]
      );
      expect(encoded).toBe(encoded2);
    });
  });

  describe("Rate Limiting Logic", () => {
    it("should track request counts per window", () => {
      interface RequestTracker {
        count: number;
        windowStart: number;
      }

      const rateLimits = new Map<string, RequestTracker>();
      const windowMs = 60000; // 1 minute
      const maxRequests = 100;

      const checkRateLimit = (key: string, now: number): boolean => {
        const tracker = rateLimits.get(key);

        if (!tracker || now - tracker.windowStart >= windowMs) {
          // New window
          rateLimits.set(key, { count: 1, windowStart: now });
          return true;
        }

        if (tracker.count >= maxRequests) {
          return false;
        }

        tracker.count++;
        return true;
      };

      const now = Date.now();
      const key = "user1";

      // First 100 requests should pass
      for (let i = 0; i < 100; i++) {
        expect(checkRateLimit(key, now)).toBe(true);
      }

      // 101st request should fail
      expect(checkRateLimit(key, now)).toBe(false);

      // After window expires, should allow again
      expect(checkRateLimit(key, now + windowMs)).toBe(true);
    });

    it("should isolate rate limits per key", () => {
      const counts = new Map<string, number>();

      const increment = (key: string): number => {
        const current = counts.get(key) || 0;
        counts.set(key, current + 1);
        return current + 1;
      };

      expect(increment("user1")).toBe(1);
      expect(increment("user1")).toBe(2);
      expect(increment("user2")).toBe(1); // Different key, fresh count
      expect(increment("user1")).toBe(3);
    });
  });

  describe("Input Sanitization", () => {
    it("should sanitize path inputs", () => {
      const sanitizePath = (path: string): string => {
        // Remove path traversal attempts
        return path.replace(/\.\./g, "").replace(/\/+/g, "/").replace(/^\/+/, "");
      };

      expect(sanitizePath("../../../etc/passwd")).toBe("etc/passwd");
      expect(sanitizePath("./file.txt")).toBe("./file.txt");
      expect(sanitizePath("normal/path/file")).toBe("normal/path/file");
      expect(sanitizePath("////multiple/slashes")).toBe("multiple/slashes");
    });

    it("should validate CID format", () => {
      const isValidCid = (cid: string): boolean => {
        // Basic CID validation (v0 and v1)
        if (!cid) return false;
        if (cid.startsWith("Qm") && cid.length === 46) return true; // CIDv0
        if (cid.startsWith("bafy") && cid.length >= 59) return true; // CIDv1
        return false;
      };

      expect(isValidCid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toBe(true);
      expect(isValidCid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")).toBe(true);
      expect(isValidCid("invalid")).toBe(false);
      expect(isValidCid("")).toBe(false);
    });
  });
});
