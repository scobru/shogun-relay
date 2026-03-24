import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isValidSession, createSession } from "./token-auth";

// Mock dependencies
vi.mock("../config/env-config", () => ({
  authConfig: {
    strictSessionIp: true,
  },
  serverConfig: {
    nodeEnv: "development",
  },
}));

vi.mock("../utils/logger", () => ({
  loggers: {
    server: {
      warn: vi.fn(),
    },
  },
}));

describe("token-auth", () => {
  describe("isValidSession", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Set an initial time so we can easily advance it
      vi.setSystemTime(new Date(2024, 1, 1, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.clearAllMocks();
    });

    it("should return false for a non-existent session ID", () => {
      const result = isValidSession("non-existent-session-id", "127.0.0.1");
      expect(result).toBe(false);
    });

    it("should return true for a valid session ID and matching IP", () => {
      const ip = "192.168.1.100";
      const sessionId = createSession(ip);

      const result = isValidSession(sessionId, ip);
      expect(result).toBe(true);
    });

    it("should return false when the session is expired", () => {
      const ip = "10.0.0.5";
      const sessionId = createSession(ip);

      // Advance time by 24 hours + 1 ms (SESSION_DURATION is 24 hours)
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);

      const result = isValidSession(sessionId, ip);
      expect(result).toBe(false);

      // Verify the session was deleted by checking it again (should return false and not delete again since it's already gone)
      const resultAgain = isValidSession(sessionId, ip);
      expect(resultAgain).toBe(false);
    });

    it("should return false for a valid session but mismatched IP when strictSessionIp is true", () => {
      const ip = "192.168.1.100";
      const differentIp = "192.168.1.200";
      const sessionId = createSession(ip);

      const result = isValidSession(sessionId, differentIp);
      expect(result).toBe(false);
    });

    it("should return true for a valid session and mismatched IP when strictSessionIp is false", async () => {
      // Need to dynamically mock authConfig for this specific test
      const { authConfig } = await import("../config/env-config");
      authConfig.strictSessionIp = false;

      const ip = "192.168.1.100";
      const differentIp = "192.168.1.200";
      const sessionId = createSession(ip);

      const result = isValidSession(sessionId, differentIp);
      expect(result).toBe(true);

      // Restore strictSessionIp for other tests
      authConfig.strictSessionIp = true;
    });
  });
});
