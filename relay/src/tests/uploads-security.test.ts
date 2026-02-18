import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be hoisted or defined before imports
// We need to define the mock router *before* vi.mock calls so it can be used inside
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
  Router: () => mockRouter, // Also mock named export just in case
}));

vi.mock("../utils/logger", () => ({
  loggers: {
    uploads: {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
    server: {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  },
}));

vi.mock("../config", () => ({
  authConfig: { adminPassword: "test-password" },
}));

vi.mock("../utils/auth-utils", () => ({
  validateAdminToken: vi.fn(),
}));

vi.mock("../utils/gun-paths", () => ({
  GUN_PATHS: { UPLOADS: "uploads", SYSTEM_HASH: "system-hash" },
}));

// Mock the middleware module
// We create a function that we can identify
const mockAdminOrApiKeyAuthMiddleware = vi.fn();
vi.mock("../middleware/admin-or-api-key-auth", () => ({
  adminOrApiKeyAuthMiddleware: mockAdminOrApiKeyAuthMiddleware,
}));

describe("Uploads Routes Security Fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("verifies that DELETE /:identifier/:hash is protected with adminOrApiKeyAuthMiddleware", async () => {
    // Import the router (this executes the code in uploads.ts)
    // We need to re-import it fresh to ensure mocks are applied
    await import("../routes/uploads");

    const deleteCalls = mockRouter.delete.mock.calls;
    const routePath = "/:identifier/:hash";

    // Find the call for the specific route
    const call = deleteCalls.find((c) => c[0] === routePath);
    expect(call, `Route DELETE ${routePath} not found`).toBeDefined();

    // The arguments are: (path, middleware1, middleware2, ..., handler)
    // We check if any of the arguments match our mock middleware
    const args = call!;
    const hasMiddleware = args.some((arg) => arg === mockAdminOrApiKeyAuthMiddleware);

    expect(
      hasMiddleware,
      `Route DELETE ${routePath} should be protected with adminOrApiKeyAuthMiddleware`
    ).toBe(true);
  });
});
