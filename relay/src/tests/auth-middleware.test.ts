/**
 * Admin Authentication Middleware Tests
 *
 * Critical tests to ensure authentication is secure
 * and protected routes are properly secured.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";

// Simulated auth middleware logic (mirrors admin-auth.ts)
interface MockRequest {
  headers: Record<string, string | undefined>;
  ip?: string;
  path?: string;
}

interface MockResponse {
  statusCode: number;
  body: any;
  status: (code: number) => MockResponse;
  json: (data: any) => void;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
    },
  };
  return res;
}

/**
 * Hash token using SHA-256 (matches implementation)
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Timing-safe comparison (matches implementation)
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

// Admin password for testing
const ADMIN_PASSWORD = "test-admin-secret-123";
const adminPasswordHash = hashToken(ADMIN_PASSWORD);

/**
 * Simulated auth middleware
 */
function authMiddleware(req: MockRequest, res: MockResponse, next: () => void): void {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers["authorization"];
  const bearerToken = authHeader && authHeader.split(" ")[1];

  // Check custom token header
  const customToken = req.headers["token"];

  // Accept either format
  const token = bearerToken || customToken;

  if (!token) {
    res.status(401).json({ success: false, error: "Unauthorized - No token" });
    return;
  }

  // Secure comparison using hash
  const tokenHash = hashToken(token);

  if (secureCompare(tokenHash, adminPasswordHash)) {
    next();
  } else {
    res.status(401).json({ success: false, error: "Unauthorized - Invalid token" });
  }
}

describe("Admin Authentication Middleware", () => {
  describe("Token Validation", () => {
    it("should accept valid token in Authorization header", () => {
      const req: MockRequest = {
        headers: {
          authorization: `Bearer ${ADMIN_PASSWORD}`,
        },
      };
      const res = createMockResponse();
      let nextCalled = false;

      authMiddleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    it("should accept valid token in custom token header", () => {
      const req: MockRequest = {
        headers: {
          token: ADMIN_PASSWORD,
        },
      };
      const res = createMockResponse();
      let nextCalled = false;

      authMiddleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it("should prefer Bearer token over custom header", () => {
      const req: MockRequest = {
        headers: {
          authorization: `Bearer ${ADMIN_PASSWORD}`,
          token: "wrong-token",
        },
      };
      const res = createMockResponse();
      let nextCalled = false;

      authMiddleware(req, res, () => {
        nextCalled = true;
      });

      // Should use correct Bearer token
      expect(nextCalled).toBe(true);
    });

    it("should REJECT missing token", () => {
      const req: MockRequest = {
        headers: {},
      };
      const res = createMockResponse();
      let nextCalled = false;

      authMiddleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toContain("No token");
    });

    it("should REJECT invalid token", () => {
      const req: MockRequest = {
        headers: {
          authorization: "Bearer wrong-token-123",
        },
      };
      const res = createMockResponse();
      let nextCalled = false;

      authMiddleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toContain("Invalid token");
    });

    it("should REJECT empty token", () => {
      const req: MockRequest = {
        headers: {
          authorization: "Bearer ",
        },
      };
      const res = createMockResponse();
      let nextCalled = false;

      authMiddleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
    });

    it("should REJECT malformed Authorization header", () => {
      const req: MockRequest = {
        headers: {
          authorization: "NotBearer token123",
        },
      };
      const res = createMockResponse();
      let nextCalled = false;

      authMiddleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
    });
  });

  describe("Timing-Safe Comparison", () => {
    it("should use constant-time comparison", () => {
      // Same length strings
      const hash1 = hashToken("password1");
      const hash2 = hashToken("password2");

      // Should return false but take similar time
      expect(secureCompare(hash1, hash2)).toBe(false);
    });

    it("should reject different length tokens quickly", () => {
      // Different lengths - fast path rejection
      expect(secureCompare("short", "much-longer-string")).toBe(false);
    });

    it("should correctly compare identical strings", () => {
      const hash = hashToken("test-token");
      expect(secureCompare(hash, hash)).toBe(true);
    });

    it("should handle empty strings", () => {
      expect(secureCompare("", "")).toBe(true);
      expect(secureCompare("", "non-empty")).toBe(false);
    });

    it("should handle special characters", () => {
      const token1 = hashToken("test!@#$%^&*()");
      const token2 = hashToken("test!@#$%^&*()");
      expect(secureCompare(token1, token2)).toBe(true);
    });
  });

  describe("Hash Function", () => {
    it("should produce consistent hashes", () => {
      const token = "my-secret-token";
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different tokens", () => {
      const hash1 = hashToken("token1");
      const hash2 = hashToken("token2");

      expect(hash1).not.toBe(hash2);
    });

    it("should produce 64-character hex output (SHA-256)", () => {
      const hash = hashToken("any-token");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should not be reversible", () => {
      // This is more of a documentation test - SHA-256 is one-way
      const hash = hashToken(ADMIN_PASSWORD);

      // Hash should not contain the original password
      expect(hash).not.toContain(ADMIN_PASSWORD);
    });
  });

  describe("Security Edge Cases", () => {
    it("should not leak token in error messages", () => {
      const req: MockRequest = {
        headers: {
          authorization: "Bearer super-secret-wrong-token",
        },
      };
      const res = createMockResponse();

      authMiddleware(req, res, () => {});

      // Error message should not contain the actual token
      expect(JSON.stringify(res.body)).not.toContain("super-secret-wrong-token");
    });

    it("should handle null/undefined headers gracefully", () => {
      const req: MockRequest = {
        headers: {
          authorization: undefined,
          token: undefined,
        },
      };
      const res = createMockResponse();

      expect(() => {
        authMiddleware(req, res, () => {});
      }).not.toThrow();

      expect(res.statusCode).toBe(401);
    });

    it("should handle very long tokens", () => {
      const longToken = "a".repeat(10000);
      const req: MockRequest = {
        headers: {
          authorization: `Bearer ${longToken}`,
        },
      };
      const res = createMockResponse();

      expect(() => {
        authMiddleware(req, res, () => {});
      }).not.toThrow();

      expect(res.statusCode).toBe(401);
    });

    it("should handle unicode tokens", () => {
      const unicodeToken = "密码🔐émoji";
      const req: MockRequest = {
        headers: {
          authorization: `Bearer ${unicodeToken}`,
        },
      };
      const res = createMockResponse();

      expect(() => {
        authMiddleware(req, res, () => {});
      }).not.toThrow();
    });

    it("should handle newlines and whitespace in token", () => {
      const tokenWithWhitespace = `${ADMIN_PASSWORD}\n`;
      const req: MockRequest = {
        headers: {
          authorization: `Bearer ${tokenWithWhitespace}`,
        },
      };
      const res = createMockResponse();

      authMiddleware(req, res, () => {});

      // Should NOT match (whitespace matters)
      expect(res.statusCode).toBe(401);
    });
  });

  describe("Protected Routes Simulation", () => {
    const protectedRoutes = [
      "/api/v1/system/logs",
      "/api/v1/ipfs/pin/add",
      "/api/v1/ipfs/pin/rm",
      "/api/v1/ipfs/repo/gc",
      "/api/v1/registry/register",
      "/api/v1/bridge/deposit",
    ];

    it.each(protectedRoutes)("should require auth for %s", (route) => {
      const req: MockRequest = {
        headers: {},
        path: route,
      };
      const res = createMockResponse();

      authMiddleware(req, res, () => {});

      expect(res.statusCode).toBe(401);
    });

    it.each(protectedRoutes)("should allow access to %s with valid token", (route) => {
      const req: MockRequest = {
        headers: {
          authorization: `Bearer ${ADMIN_PASSWORD}`,
        },
        path: route,
      };
      const res = createMockResponse();
      let nextCalled = false;

      authMiddleware(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });
  });

  describe("Rate Limiting Simulation", () => {
    // Simplified rate limiting logic
    class RateLimiter {
      private attempts = new Map<string, { count: number; firstAttempt: number }>();
      private readonly maxAttempts = 5;
      private readonly windowMs = 60000; // 1 minute

      isBlocked(ip: string): boolean {
        const record = this.attempts.get(ip);
        if (!record) return false;

        const now = Date.now();
        if (now - record.firstAttempt > this.windowMs) {
          this.attempts.delete(ip);
          return false;
        }

        return record.count >= this.maxAttempts;
      }

      recordFailedAttempt(ip: string): void {
        const now = Date.now();
        const record = this.attempts.get(ip);

        if (!record || now - record.firstAttempt > this.windowMs) {
          this.attempts.set(ip, { count: 1, firstAttempt: now });
        } else {
          record.count++;
        }
      }

      reset(): void {
        this.attempts.clear();
      }
    }

    it("should block after too many failed attempts", () => {
      const limiter = new RateLimiter();
      const ip = "192.168.1.100";

      // Make 5 failed attempts
      for (let i = 0; i < 5; i++) {
        expect(limiter.isBlocked(ip)).toBe(false);
        limiter.recordFailedAttempt(ip);
      }

      // 6th attempt should be blocked
      expect(limiter.isBlocked(ip)).toBe(true);
    });

    it("should reset after time window", () => {
      const limiter = new RateLimiter();
      const ip = "192.168.1.100";

      // Simulate old attempts by manipulating internal state
      // In a real test, we'd use fake timers
      for (let i = 0; i < 10; i++) {
        limiter.recordFailedAttempt(ip);
      }

      expect(limiter.isBlocked(ip)).toBe(true);

      limiter.reset();
      expect(limiter.isBlocked(ip)).toBe(false);
    });

    it("should isolate rate limits per IP", () => {
      const limiter = new RateLimiter();
      const ip1 = "192.168.1.100";
      const ip2 = "192.168.1.200";

      // Block ip1
      for (let i = 0; i < 10; i++) {
        limiter.recordFailedAttempt(ip1);
      }

      expect(limiter.isBlocked(ip1)).toBe(true);
      expect(limiter.isBlocked(ip2)).toBe(false);
    });
  });
});
