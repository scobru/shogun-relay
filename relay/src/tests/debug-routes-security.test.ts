import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be hoisted or defined before imports if using vi.mock factory
const mockRouter = {
  get: vi.fn(),
  post: vi.fn(),
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

vi.mock("../utils/gun-paths", () => ({
  GUN_PATHS: {
    MB_USAGE: "mb-usage",
    UPLOADS: "uploads",
    TEST: "test",
  },
}));

// Mock the middleware module
vi.mock("../middleware/admin-auth", () => ({
  adminAuthMiddleware: vi.fn(),
}));

describe("Debug Routes Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should apply adminAuthMiddleware to all routes", async () => {
    // Import the middleware to get the mock reference
    const { adminAuthMiddleware } = await import("../middleware/admin-auth");

    // Import the router (this executes the code in debug.ts)
    await import("../routes/debug");

    // Check if router.use was called with the middleware
    // If this fails, it means the routes are unprotected!
    expect(mockRouter.use).toHaveBeenCalledWith(adminAuthMiddleware);
  });
});
