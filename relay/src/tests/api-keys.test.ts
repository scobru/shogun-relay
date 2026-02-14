/**
 * API Keys Manager Tests
 *
 * Tests for API key management and validation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiKeysManager, hashApiKey } from "../utils/api-keys";
import { secureCompare } from "../utils/security";

// Mock GunDB
const mockGun = {
  get: vi.fn().mockReturnThis(),
  map: vi.fn().mockReturnThis(),
  once: vi.fn(),
  put: vi.fn(),
};

const mockRelayUser = {
  is: { pub: "relay-pub-key" },
  get: vi.fn().mockReturnThis(),
  put: vi.fn(),
};

describe("ApiKeysManager", () => {
  let manager: ApiKeysManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ApiKeysManager(mockGun, "relay-pub-key", mockRelayUser);
  });

  describe("validateApiKey", () => {
    it("should validate a correct API key", async () => {
      const token = "shogun-api-1234567890abcdef1234567890abcdef";
      const tokenHash = hashApiKey(token);

      const mockKeyData = {
        keyId: "key-123",
        name: "Test Key",
        hash: tokenHash,
        createdAt: Date.now(),
        expiresAt: null,
      };

      // Mock finding the key
      mockGun.once.mockImplementation((cb) => {
        cb(mockKeyData, "key-123");
      });

      const result = await manager.validateApiKey(token);

      expect(result).not.toBeNull();
      expect(result?.keyId).toBe("key-123");
      expect(result?.name).toBe("Test Key");
    });

    it("should reject an incorrect API key", async () => {
      const token = "shogun-api-wrongtoken";

      const mockKeyData = {
        keyId: "key-123",
        name: "Test Key",
        hash: "some-other-hash",
        createdAt: Date.now(),
        expiresAt: null,
      };

      // Mock finding a key with different hash
      mockGun.once.mockImplementation((cb) => {
        cb(mockKeyData, "key-123");
      });

      const result = await manager.validateApiKey(token);

      expect(result).toBeNull();
    });

    it("should reject an expired API key", async () => {
      const token = "shogun-api-expired";
      const tokenHash = hashApiKey(token);

      const mockKeyData = {
        keyId: "key-expired",
        name: "Expired Key",
        hash: tokenHash,
        createdAt: Date.now() - 100000,
        expiresAt: Date.now() - 1000, // Expired
      };

      mockGun.once.mockImplementation((cb) => {
        cb(mockKeyData, "key-expired");
      });

      const result = await manager.validateApiKey(token);

      expect(result).toBeNull();
    });
  });
});
