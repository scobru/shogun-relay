import { describe, it, expect } from "vitest";
import {
  hashToken,
  secureCompare,
  isValidEthereumAddress,
  isValidAmount,
  validateString,
  isValidSignatureFormat,
  sanitizeForLog,
  isValidChainId,
  getChainName,
  sanitizeErrorForProduction
} from "./security";

describe("Security Utilities", () => {
  describe("hashToken", () => {
    it("should return a deterministic SHA-256 hash", () => {
      const token = "test-token";
      const expectedHash = "4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e";
      expect(hashToken(token)).toBe(expectedHash);
    });

    it("should return the same hash for the same token", () => {
      const token = "stable-token";
      expect(hashToken(token)).toBe(hashToken(token));
    });

    it("should handle empty strings correctly", () => {
      const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      expect(hashToken("")).toBe(emptyHash);
    });

    it("should produce different hashes for different tokens", () => {
      expect(hashToken("token1")).not.toBe(hashToken("token2"));
    });
  });

  describe("secureCompare", () => {
    it("should return true for identical strings", () => {
      expect(secureCompare("abc", "abc")).toBe(true);
    });

    it("should return false for different strings", () => {
      expect(secureCompare("abc", "def")).toBe(false);
    });

    it("should return false for strings of different lengths", () => {
      expect(secureCompare("abc", "abcd")).toBe(false);
    });

    it("should return false for empty and non-empty strings", () => {
      expect(secureCompare("", "a")).toBe(false);
    });
  });

  describe("isValidEthereumAddress", () => {
    it("should return true for valid Ethereum addresses", () => {
      expect(isValidEthereumAddress("0x1234567890123456789012345678901234567890")).toBe(true);
      expect(isValidEthereumAddress("0xABCDEF0123456789ABCDEF0123456789ABCDEF01")).toBe(true);
    });

    it("should return false for invalid formats", () => {
      expect(isValidEthereumAddress("1234567890123456789012345678901234567890")).toBe(false); // missing 0x
      expect(isValidEthereumAddress("0x123")).toBe(false); // too short
      expect(isValidEthereumAddress("0x123456789012345678901234567890123456789G")).toBe(false); // non-hex
    });

    it("should return false for non-string inputs", () => {
      expect(isValidEthereumAddress(null as any)).toBe(false);
      expect(isValidEthereumAddress(123 as any)).toBe(false);
    });
  });

  describe("isValidAmount", () => {
    it("should return valid for positive amounts within bounds", () => {
      expect(isValidAmount(100n)).toEqual({ valid: true });
    });

    it("should return error for non-positive amounts", () => {
      expect(isValidAmount(0n).valid).toBe(false);
      expect(isValidAmount(-1n).valid).toBe(false);
    });

    it("should return error for amounts exceeding uint256 max", () => {
      const tooBig = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF") + 1n;
      expect(isValidAmount(tooBig).valid).toBe(false);
    });
  });

  describe("validateString", () => {
    it("should return valid and sanitized string", () => {
      const result = validateString("hello\0world", "field");
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe("helloworld");
    });

    it("should respect length constraints", () => {
      expect(validateString("a", "field", 10, 2).valid).toBe(false);
      expect(validateString("abc", "field", 2, 0).valid).toBe(false);
    });

    it("should return error for non-string inputs", () => {
      expect(validateString(123 as any, "field").valid).toBe(false);
    });
  });

  describe("isValidSignatureFormat", () => {
    it("should validate ethereum signatures", () => {
      const validEthSig = "0x" + "a".repeat(130);
      expect(isValidSignatureFormat(validEthSig, "eth")).toBe(true);
      expect(isValidSignatureFormat("0x123", "eth")).toBe(false);
    });

    it("should validate SEA signatures", () => {
      const validSeaSig = "a".repeat(100);
      expect(isValidSignatureFormat(validSeaSig, "sea")).toBe(true);
      expect(isValidSignatureFormat("short", "sea")).toBe(false);
    });
  });

  describe("isValidChainId", () => {
    it("should return true for allowed chain IDs", () => {
      expect(isValidChainId(1, [1, 137]).valid).toBe(true);
    });

    it("should return false for disallowed chain IDs", () => {
      expect(isValidChainId(2, [1, 137]).valid).toBe(false);
    });

    it("should return false for invalid chain ID formats", () => {
      expect(isValidChainId(0, [1]).valid).toBe(false);
      expect(isValidChainId(-1, [1]).valid).toBe(false);
      expect(isValidChainId(1.5, [1]).valid).toBe(false);
    });
  });

  describe("sanitizeForLog", () => {
    it("should redact sensitive fields", () => {
      const data = {
        username: "user1",
        password: "secretpassword",
        nested: { token: "token123" }
      };
      const sanitized = sanitizeForLog(data);
      expect(sanitized.username).toBe("user1");
      expect(sanitized.password).toBe("***REDACTED***");
      expect(sanitized.nested.token).toBe("***REDACTED***");
    });

    it("should truncate long strings", () => {
      const longString = "a".repeat(300);
      const data = { long: longString };
      const sanitized = sanitizeForLog(data);
      expect(sanitized.long.length).toBe(203); // 200 + "..."
      expect(sanitized.long.endsWith("...")).toBe(true);
    });

    it("should handle arrays", () => {
      const data = [{ password: "123" }, "normal"];
      const sanitized = sanitizeForLog(data);
      expect(sanitized[0].password).toBe("***REDACTED***");
      expect(sanitized[1]).toBe("normal");
    });
  });

  describe("getChainName", () => {
    it("should return known chain names", () => {
      expect(getChainName(1)).toBe("Ethereum Mainnet");
      expect(getChainName(137)).toBe("Polygon Mainnet");
    });

    it("should return default name for unknown chain IDs", () => {
      expect(getChainName(999)).toBe("Chain 999");
    });
  });

  describe("sanitizeErrorForProduction", () => {
    it("should return full error in development", () => {
      const error = new Error("Specific error message");
      const result = sanitizeErrorForProduction(error, false);
      expect(result.message).toBe("Specific error message");
    });

    it("should return generic message for known error codes in production", () => {
      const error = new Error("Original message");
      (error as any).code = "ECONNREFUSED";
      const result = sanitizeErrorForProduction(error, true);
      expect(result.message).toBe("Service temporarily unavailable");
    });

    it("should redact sensitive information from error messages in production", () => {
      const error = new Error("Failed with password: mypassword");
      const result = sanitizeErrorForProduction(error, true);
      expect(result.message).toBe("An internal error occurred. Please try again later.");
    });

    it("should truncate long error messages in production", () => {
      const longMessage = "a".repeat(200);
      const result = sanitizeErrorForProduction(longMessage, true);
      expect(result.message.length).toBe(100);
    });
  });
});
