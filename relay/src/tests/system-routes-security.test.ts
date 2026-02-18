import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be hoisted or defined before imports
const mockRouter = {
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  use: vi.fn(),
};

vi.mock("express", () => ({
  default: {
    Router: () => mockRouter,
  },
}));

vi.mock("../utils/logger", () => ({
  loggers: {
    server: {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  },
}));

vi.mock("../config", () => ({
  packageConfig: { version: "1.0.0" },
  config: { relay: { name: "test-relay" }, registry: { chainId: 1 } },
}));

vi.mock("../config/env-config", () => ({
  config: { relay: { name: "test-relay" } },
}));

vi.mock("../utils/gun-paths", () => ({
  GUN_PATHS: { SHOGUN: "shogun", LOGS: "logs" },
  getGunNode: vi.fn(),
}));

// Create a unique symbol to identify the middleware
const middlewareSymbol = Symbol("adminAuthMiddleware");
const mockAdminAuthMiddleware = () => {};
// @ts-ignore
mockAdminAuthMiddleware.id = middlewareSymbol;

// Mock the middleware module
vi.mock("../middleware/admin-auth", () => ({
  adminAuthMiddleware: mockAdminAuthMiddleware,
}));

describe("System Routes Security Fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("verifies that sensitive routes are protected with adminAuthMiddleware", async () => {
    // Import the router (this executes the code in system.ts)
    await import("../routes/system");

    // Helper to check if a route is protected
    const verifyRouteProtected = (method: "get" | "post" | "delete", path: string) => {
      const calls = mockRouter[method].mock.calls;
      const call = calls.find((c) => c[0] === path);

      expect(call, `Route ${method.toUpperCase()} ${path} not found`).toBeDefined();

      // Check if middleware is applied (it should be the second argument)
      // The handler is usually the last argument.
      // If middleware is present, the call signature is (path, middleware, handler)
      // or (path, middleware1, middleware2, ..., handler)

      const args = call!;
      const hasMiddleware = args.some((arg) => arg === mockAdminAuthMiddleware);

      expect(
        hasMiddleware,
        `Route ${method.toUpperCase()} ${path} should be protected with adminAuthMiddleware`
      ).toBe(true);
    };

    const verifyRoutePublic = (method: "get" | "post" | "delete", path: string) => {
      const calls = mockRouter[method].mock.calls;
      const call = calls.find((c) => c[0] === path);

      expect(call, `Route ${method.toUpperCase()} ${path} not found`).toBeDefined();

      const args = call!;
      const hasMiddleware = args.some((arg) => arg === mockAdminAuthMiddleware);

      expect(hasMiddleware, `Route ${method.toUpperCase()} ${path} should NOT be protected`).toBe(
        false
      );
    };

    // Public routes
    verifyRoutePublic("get", "/health");
    verifyRoutePublic("get", "/relay-info");
    verifyRoutePublic("get", "/stats");
    verifyRoutePublic("get", "/stats.json");
    verifyRoutePublic("get", "/peers");
    verifyRoutePublic("get", "/contracts");

    // Protected routes (CRITICAL)
    verifyRouteProtected("get", "/alldata");
    verifyRouteProtected("post", "/stats/update");
    verifyRouteProtected("get", "/node/*");
    verifyRouteProtected("post", "/node/*");
    verifyRouteProtected("delete", "/node/*");
    verifyRouteProtected("get", "/logs");
    verifyRouteProtected("delete", "/logs");
    verifyRouteProtected("post", "/peers/add");
    verifyRouteProtected("get", "/services/:name/logs");
    verifyRouteProtected("post", "/rpc/execute");
  });
});
