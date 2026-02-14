import { describe, it, expect, vi } from "vitest";

// Mock config BEFORE importing auth-utils
vi.mock("../config", () => ({
  authConfig: {
    adminPassword: "test-admin-password",
  },
}));

import { validateAdminToken } from "../utils/auth-utils";

describe("Authentication Utilities", () => {
  describe("validateAdminToken", () => {
    it("should return true for correct admin password", () => {
      expect(validateAdminToken("test-admin-password")).toBe(true);
    });

    it("should return false for incorrect admin password", () => {
      expect(validateAdminToken("wrong-password")).toBe(false);
    });

    it("should return false for null/undefined token", () => {
      expect(validateAdminToken(null)).toBe(false);
      expect(validateAdminToken(undefined)).toBe(false);
    });

    it("should return false for empty token", () => {
      expect(validateAdminToken("")).toBe(false);
    });
  });
});
