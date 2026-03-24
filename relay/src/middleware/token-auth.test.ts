import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import {
  tokenAuthMiddleware,
  isRateLimited,
  recordFailedAttempt,
  createSession,
  isValidSession,
  getAdminPasswordHash,
} from "./token-auth";
import { authConfig, serverConfig } from "../config/env-config";
import { secureCompare, hashToken } from "../utils/security";


vi.mock("../utils/security", () => ({
  hashToken: vi.fn((token: string) => `hashed-${token}`),
  secureCompare: vi.fn((a: string, b: string) => a === b),
}));

vi.mock("../config/env-config", () => ({
  authConfig: {
    adminPassword: "test-admin-password",
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


describe("tokenAuthMiddleware Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // clear map implicitly by waiting out the rate limit
    vi.advanceTimersByTime(15 * 60 * 1000 + 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Rate Limiting", () => {
    it("should return false for a new IP", () => {
      expect(isRateLimited("192.168.1.1")).toBe(false);
    });

    it("should rate limit after 5 failed attempts", () => {
      const ip = "192.168.1.2";
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt(ip);
      }
      expect(isRateLimited(ip)).toBe(true);
    });

    it("should clear rate limit after the window expires", () => {
      const ip = "192.168.1.3";
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt(ip);
      }
      expect(isRateLimited(ip)).toBe(true);

      // Advance time by 15 minutes + 1 second
      vi.advanceTimersByTime(15 * 60 * 1000 + 1000);

      expect(isRateLimited(ip)).toBe(false);
    });
  });

  describe("Session Management", () => {
    it("should create a valid session", () => {
      const ip = "192.168.1.4";
      const sessionId = createSession(ip);
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
      expect(isValidSession(sessionId, ip)).toBe(true);
    });

    it("should invalidate session after duration", () => {
      const ip = "192.168.1.5";
      const sessionId = createSession(ip);
      expect(isValidSession(sessionId, ip)).toBe(true);

      // Advance time by 24 hours + 1 second
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);

      expect(isValidSession(sessionId, ip)).toBe(false);
    });

    it("should enforce strict IP matching if configured", () => {
      const ip = "192.168.1.6";
      const sessionId = createSession(ip);

      // Attempt to validate from a different IP
      expect(isValidSession(sessionId, "192.168.1.7")).toBe(false);
    });
  });

  describe("Admin Password Hash", () => {
    it("should return the hashed admin password", () => {
      const hash = getAdminPasswordHash();
      expect(hashToken).toHaveBeenCalledWith("test-admin-password");
      expect(hash).toBe("hashed-test-admin-password");
    });
  });
});


describe("tokenAuthMiddleware", () => {
  let req: Partial<Request>;
  let ipCounter = 100;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    const currentIp = `10.0.0.${ipCounter++}`; req = { ip: currentIp, socket: { remoteAddress: currentIp } as any,
      headers: {},
      cookies: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      cookie: vi.fn(),
    };
    next = vi.fn();
    vi.useFakeTimers();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should block request if IP is rate limited", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(req.ip as string);
    }

    tokenAuthMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Too many failed authentication attempts. Please try again later.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should allow request with a valid session header", () => {
    const sessionId = createSession(req.ip as string);
    req.headers = { "x-session-token": sessionId };

    tokenAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should allow request with a valid session cookie", () => {
    const sessionId = createSession(req.ip as string);
    req.cookies = { sessionToken: sessionId };

    tokenAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should require a token if no session exists", () => {
    tokenAuthMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: "Unauthorized - Token required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject invalid token authentication via Authorization header", () => {
    req.headers = { authorization: "Bearer invalid-password" };

    tokenAuthMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: "Unauthorized - Invalid token" });
    expect(next).not.toHaveBeenCalled();
  });

  it("should allow valid token authentication via Authorization header and create session", () => {
    req.headers = { authorization: "Bearer test-admin-password" };

    tokenAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("X-Session-Token", expect.any(String));
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should allow valid token authentication via custom token header", () => {
    req.headers = { token: "test-admin-password" };

    tokenAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("X-Session-Token", expect.any(String));
  });

  it("should optionally set a session cookie if Accept: text/html is provided", () => {
    req.headers = {
      authorization: "Bearer test-admin-password",
      accept: "text/html,application/xhtml+xml",
    };

    tokenAuthMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalledWith("sessionToken", expect.any(String), expect.objectContaining({
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "strict",
    }));
  });
});
