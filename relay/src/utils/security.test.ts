import { describe, it, expect, vi } from "vitest";
import {
  secureCompare,
  hashToken,
  isValidEthereumAddress,
  isValidAmount,
  validateString,
  isValidSignatureFormat,
  sanitizeForLog,
  isValidChainId,
  getChainName,
  sanitizeErrorForProduction,
  isOriginAllowed
} from "./security";

// Mock the logger
vi.mock("./logger", () => ({
  loggers: {
    server: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

describe("security utilities", () => {
  describe("isOriginAllowed", () => {
    it("should allow when * is in allowed origins", () => {
      expect(isOriginAllowed("https://anything.com", ["*"])).toBe(true);
      expect(isOriginAllowed("http://localhost:3000", ["https://app.com", "*"])).toBe(true);
    });

    it("should reject when allowedOrigins is empty", () => {
      expect(isOriginAllowed("https://app.com", [])).toBe(false);
    });

    it("should allow exact matches", () => {
      expect(isOriginAllowed("https://app.com", ["https://app.com", "http://localhost:3000"])).toBe(true);
      expect(isOriginAllowed("http://localhost:3000", ["https://app.com", "http://localhost:3000"])).toBe(true);
      expect(isOriginAllowed("https://sub.test.com", ["https://sub.test.com"])).toBe(true);
    });

    it("should reject prefix/suffix spoofing on exact matches", () => {
      expect(isOriginAllowed("https://attacker-app.com", ["https://app.com"])).toBe(false);
      expect(isOriginAllowed("https://app.com.attacker.com", ["https://app.com"])).toBe(false);
      expect(isOriginAllowed("https://attacker-https://app.com", ["https://app.com"])).toBe(false);
    });

    it("should handle domain-only (no protocol) allowed origins securely", () => {
      const allowed = ["myapp.com", "localhost:3000"];
      expect(isOriginAllowed("https://myapp.com", allowed)).toBe(true);
      expect(isOriginAllowed("http://myapp.com", allowed)).toBe(true);
      expect(isOriginAllowed("https://myapp.com:8080", allowed)).toBe(true);
      expect(isOriginAllowed("http://localhost:3000", allowed)).toBe(true);

      // Malicious or incorrect origins
      expect(isOriginAllowed("https://attacker-myapp.com", allowed)).toBe(false);
      expect(isOriginAllowed("https://myapp.com.attacker.com", allowed)).toBe(false);
      expect(isOriginAllowed("http://localhost:3001", allowed)).toBe(false);
    });

    it("should handle wildcard domains without explicit protocol", () => {
      const allowed = ["*.test.com"];
      expect(isOriginAllowed("https://sub.test.com", allowed)).toBe(true);
      expect(isOriginAllowed("https://deep.sub.test.com", allowed)).toBe(true);
      expect(isOriginAllowed("https://test.com", allowed)).toBe(true);
      expect(isOriginAllowed("http://sub.test.com:8080", allowed)).toBe(true);

      // Malicious or incorrect origins
      expect(isOriginAllowed("https://attackertest.com", allowed)).toBe(false);
      expect(isOriginAllowed("https://test.com.attacker.com", allowed)).toBe(false);
    });

    it("should handle wildcard domains with explicit protocol", () => {
      const allowed = ["https://*.secure.com"];
      expect(isOriginAllowed("https://sub.secure.com", allowed)).toBe(true);
      expect(isOriginAllowed("https://secure.com", allowed)).toBe(true);

      // Malicious or incorrect origins
      expect(isOriginAllowed("http://sub.secure.com", allowed)).toBe(false); // Wrong protocol
      expect(isOriginAllowed("https://attackersecure.com", allowed)).toBe(false);
    });

    it("should safely ignore unparseable invalid origins", () => {
      expect(isOriginAllowed("not-a-valid-url", ["https://app.com", "myapp.com"])).toBe(false);
    });
  });
});
