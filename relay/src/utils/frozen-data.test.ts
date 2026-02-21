import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFrozenEntry } from "./frozen-data";
import Gun from "gun";
import "gun/sea.js";

// Mock logger
vi.mock("./logger", () => ({
  loggers: {
    frozenData: {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  },
}));

// Mock Gun chain
const mockChain = {
    get: vi.fn().mockReturnThis(),
    put: vi.fn().mockReturnThis(),
    once: vi.fn(),
    map: vi.fn().mockReturnThis(),
};

const mockGun = {
    get: vi.fn().mockReturnValue(mockChain),
} as any;

describe("Frozen Data Utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementation
    mockChain.get.mockReturnThis();
    mockChain.put.mockReturnThis();
    mockChain.once.mockImplementation((cb: any) => {
        cb(undefined);
    });
  });

  it("should create a frozen entry using crypto (NOT SEA.work)", async () => {
    const pair = await Gun.SEA.pair();
    const data = { hello: "world" };

    // Spy on SEA.work
    const seaWorkSpy = vi.spyOn(Gun.SEA, 'work');

    const result = await createFrozenEntry(mockGun, data, pair, "test-namespace");

    // Should NOT call SEA.work because we switched to native crypto
    expect(seaWorkSpy).not.toHaveBeenCalled();

    expect(result.hash).toBeDefined();
    // Check if hash is base64 string
    expect(result.hash).toMatch(/^[a-zA-Z0-9+/]+={0,2}$/);

    seaWorkSpy.mockRestore();
  });
});
